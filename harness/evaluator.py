"""Pluggable, checkable evaluators: turn a task workspace into a graded result.

An Evaluator runs an EXECUTABLE check over a task's workspace (a reference diff, a
test suite) and returns a uniform ``EvalResult`` that the validator, improver, and
cockpit consume regardless of task. "Checkable only" by design: the signal is a
real diff or a real test run, un-gameable where the checks are real (no LLM judge).

The result shape generalizes the tokenizer oracle's dict:

    score      float 0..1   primary metric (exact-match / pass fraction)
    passed     int          items that passed
    total      int          items checked
    pass_at_1  float        single shot, no retries (== score for these evaluators)
    wall_ms    int          wall time of the check
    failures   list[dict]   up to N {item, group, expected?, got?, message?}
    by_group   dict         group -> {total, passed, failed}  (steers the improver)
    error      str          "" on success, else a human readable reason

``by_group`` is whatever dimension a task's failures cluster by: input category for
the tokenizer, test module for pytest. The improver picks the biggest failing
group next, exactly as before, so the loop is evaluator-agnostic.

Interface other pillars build on:
    Evaluator.evaluate(workspace, *, seed=None) -> EvalResult
    OracleDiffEvaluator(bin_path, fixtures)     the tokenizer's exact-match oracle
    PytestEvaluator(...)                         (added with the textkit task)
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Protocol, runtime_checkable

from .oracle import run_oracle


@dataclass
class EvalResult:
    """The uniform graded result every evaluator returns."""

    score: float
    passed: int
    total: int
    pass_at_1: float = 0.0
    wall_ms: int = 0
    failures: list[dict[str, Any]] = field(default_factory=list)
    by_group: dict[str, dict[str, int]] = field(default_factory=dict)
    error: str = ""
    # Optional task-specific metrics that ride alongside the uniform fields (e.g. the
    # perf task's raw cycle count, baseline, target). Empty for tokenizer/textkit.
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def accuracy(self) -> float:
        """Back-compat alias: callers that read ``accuracy`` still work."""
        return self.score

    def to_payload(self) -> dict[str, Any]:
        """A compact, JSON-safe projection for event payloads / the cockpit."""
        return {
            "accuracy": self.score,
            "score": self.score,
            "passed": self.passed,
            "total": self.total,
            "pass_at_1": self.pass_at_1,
            "wall_ms": self.wall_ms,
            "by_group": self.by_group,
            "error": self.error,
            "extra": self.extra,
        }


@runtime_checkable
class Evaluator(Protocol):
    """Anything that grades a workspace into an EvalResult."""

    def evaluate(self, workspace: Path, *, seed: Optional[int] = None) -> EvalResult:
        ...


class OracleDiffEvaluator:
    """Exact token-ID diff vs tiktoken gpt2 ground truth (the tokenizer task).

    Wraps ``harness.oracle.run_oracle`` (the de-gated binary run + exact-match
    diff over fixtures.jsonl) and reshapes its dict into an EvalResult. ``by_group``
    is the oracle's per-category tally; ``failures`` are the per-line mismatches.
    The ``workspace`` argument is accepted for interface uniformity; this evaluator
    grades the built binary the task already points at (built by ``Task.build``).
    """

    def __init__(
        self,
        bin_path: Optional[str | Path] = None,
        fixtures: Optional[str | Path] = None,
    ) -> None:
        self.bin_path = bin_path
        self.fixtures = fixtures

    def evaluate(self, workspace: Path, *, seed: Optional[int] = None) -> EvalResult:
        kwargs: dict[str, Any] = {"bin_path": self.bin_path, "seed": seed}
        if self.fixtures is not None:
            kwargs["fixtures"] = self.fixtures
        res = run_oracle(**kwargs)
        # Normalize each failure to a uniform "group" key (the oracle reports
        # "category") so consumers (worker prompts, cockpit) are evaluator-agnostic.
        failures = []
        for f in res.get("failed_examples", []):
            g = dict(f)
            if "group" not in g and "category" in g:
                g["group"] = g["category"]
            failures.append(g)
        return EvalResult(
            score=float(res.get("accuracy", 0.0)),
            passed=int(res.get("passed", 0)),
            total=int(res.get("total", 0)),
            pass_at_1=float(res.get("pass_at_1", res.get("accuracy", 0.0))),
            wall_ms=int(res.get("wall_ms", 0)),
            failures=failures,
            by_group=dict(res.get("by_category", {})),
            error=str(res.get("error", "")),
        )


def _group_from_classname(name: str) -> str:
    """Map a pytest junit classname/name to a group.

    e.g. 'tests.test_slug' -> 'slug', 'tests/test_slug.py' -> 'slug'. Robust to path
    separators and a .py suffix so a collection/import error (which pytest records
    with an empty classname and the dotted path in `name`) still attributes to its
    real group rather than an empty bucket.
    """
    s = (name or "").replace("/", ".")
    if s.endswith(".py"):
        s = s[:-3]
    last = s.split(".")[-1]
    return last[len("test_"):] if last.startswith("test_") else last


class PytestEvaluator:
    """Run a task's pytest suite and grade it by pass fraction, grouped by module.

    Runs ``pytest`` in the workspace, writing a JUnit XML report (built into pytest,
    no plugin), then parses per-test results. ``score`` = passed/total, ``by_group``
    is keyed by the test module's group (test_slug.py -> slug), and ``failures``
    carry the failing test name and message. Un-gameable where the tests are real.

    The root venv has no pytest, so by default it runs ``uv run --with pytest`` to
    pull an ephemeral (cached) pytest; set ``with_pytest=False`` if pytest is a
    project dependency. pytest is run with cwd=workspace so the package imports.
    """

    def __init__(
        self,
        test_args: Optional[list[str]] = None,
        with_pytest: bool = True,
        timeout_s: int = 120,
    ) -> None:
        self.test_args = test_args or ["-q"]
        self.with_pytest = with_pytest
        self.timeout_s = timeout_s

    def evaluate(self, workspace: Path, *, seed: Optional[int] = None) -> EvalResult:
        xml_fd, xml_path = tempfile.mkstemp(suffix=".xml", prefix="glassbox-pytest-")
        os.close(xml_fd)
        cmd = ["uv", "run"]
        if self.with_pytest:
            cmd += ["--with", "pytest"]
        cmd += ["python", "-m", "pytest", *self.test_args, f"--junitxml={xml_path}"]
        t0 = time.perf_counter()
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(workspace),
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
            )
        except subprocess.TimeoutExpired:
            return EvalResult(0.0, 0, 0, error=f"pytest timed out after {self.timeout_s}s")
        except OSError as exc:
            return EvalResult(0.0, 0, 0, error=f"failed to run pytest: {exc}")
        wall_ms = int((time.perf_counter() - t0) * 1000)

        try:
            tree = ET.parse(xml_path)
        except (ET.ParseError, OSError) as exc:
            stderr = (proc.stderr or "").strip().replace("\n", " ")[:200]
            return EvalResult(
                0.0, 0, 0, wall_ms=wall_ms,
                error=f"no/invalid junit report ({exc}); pytest said: {stderr}",
            )
        finally:
            try:
                os.unlink(xml_path)
            except OSError:
                pass

        by_group: dict[str, dict[str, int]] = {}
        failures: list[dict[str, Any]] = []
        passed = total = 0
        for tc in tree.getroot().iter("testcase"):
            total += 1
            group = _group_from_classname(tc.get("classname") or tc.get("name") or "")
            g = by_group.setdefault(group, {"total": 0, "passed": 0, "failed": 0})
            g["total"] += 1
            node = tc.find("failure")
            if node is None:
                node = tc.find("error")
            if node is not None:
                g["failed"] += 1
                if len(failures) < 20:
                    failures.append(
                        {
                            "group": group,
                            "test": tc.get("name", ""),
                            "message": (node.get("message", "") or "")[:200],
                        }
                    )
            else:
                g["passed"] += 1
                passed += 1

        score = passed / total if total else 0.0
        error = "" if total else "pytest collected no tests"
        return EvalResult(
            score=score,
            passed=passed,
            total=total,
            pass_at_1=score,
            wall_ms=wall_ms,
            failures=failures,
            by_group=by_group,
            error=error,
        )


_CYCLES_RE = re.compile(r"CYCLES:\s*(\d+)")


class PerfTakehomeEvaluator:
    """Grade Anthropic's performance take-home: fewest simulated clock cycles.

    Runs the take-home's own grader (``tests/submission_tests.py``, unmodified) in
    the workspace, parses the printed ``CYCLES:`` count and whether the kernel is
    still correct, and grades by a higher-is-better normalized speedup so the rest
    of the pipeline (the BYO worker's keep-if-improves, the leaderboard, Weave) is
    unchanged. The raw cycle count rides along in ``extra`` for the cockpit gauge.

    Correctness is the floor: a kernel with wrong output scores 0. Above the floor,
    ``score`` interpolates (log scale) from the baseline cycle count down to the
    target. ``by_group`` reports one published milestone per group (passed once the
    cycle count drops below that bar), which is exactly the signal the BYO
    re-attempt loop steers on; ``failures`` carry a "reduce below X" message per
    still-unbeaten milestone so the worker prompt has a concrete target.

    Correctness is read from stdout, not the exit code: the grader exits nonzero
    whenever a speed bar is unmet (which is expected, not a failure), so we key on
    a printed ``CYCLES:`` plus the absence of the "Incorrect output" assertion.
    """

    BASELINE = 147734  # the unoptimized kernel on the (10, 16, 256) workload
    TARGET = 1363  # Anthropic's best published result
    MILESTONES = (18532, 2164, 1790, 1487, 1363)  # published sub-baseline bars

    def __init__(self, timeout_s: int = 120) -> None:
        self.timeout_s = timeout_s

    @staticmethod
    def cap_for(milestone: int) -> str:
        """The capability/group name for a cycle bar (e.g. 18532 -> 'm18532')."""
        return f"m{milestone}"

    def evaluate(self, workspace: Path, *, seed: Optional[int] = None) -> EvalResult:
        workspace = Path(workspace).resolve()
        grader = workspace / "tests" / "submission_tests.py"
        n = len(self.MILESTONES)
        if not grader.exists():
            return EvalResult(0.0, 0, n, error=f"grader not found at {grader}")
        t0 = time.perf_counter()
        try:
            proc = subprocess.run(
                [sys.executable, str(grader)],
                cwd=str(workspace),
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
            )
        except subprocess.TimeoutExpired:
            wall_ms = int((time.perf_counter() - t0) * 1000)
            return EvalResult(
                0.0, 0, n, wall_ms=wall_ms,
                error=f"grader timed out after {self.timeout_s}s",
            )
        except OSError as exc:
            return EvalResult(0.0, 0, n, error=f"failed to run grader: {exc}")
        wall_ms = int((time.perf_counter() - t0) * 1000)
        out = f"{proc.stdout or ''}\n{proc.stderr or ''}"

        cyc = [int(m) for m in _CYCLES_RE.findall(out)]
        cycles = min(cyc) if cyc else None
        incorrect = "Incorrect output" in out or "Incorrect result" in out
        correct = cycles is not None and not incorrect
        if not correct:
            why = (
                "incorrect output"
                if incorrect
                else "no CYCLES emitted (build_kernel likely raised)"
            )
            tail = (proc.stderr or "").strip().replace("\n", " ")[-180:]
            return self._grade(None, False, wall_ms, f"{why}; grader said: {tail}")
        return self._grade(cycles, True, wall_ms, "")

    def _grade(
        self,
        cycles: Optional[int],
        correct: bool,
        wall_ms: int,
        error: str,
    ) -> EvalResult:
        ms = self.MILESTONES
        if correct and cycles:
            score = self._score(cycles)
            speedup = round(self.BASELINE / cycles, 2)
            by_group = {
                self.cap_for(m): {
                    "total": 1,
                    "passed": int(cycles < m),
                    "failed": int(cycles >= m),
                }
                for m in ms
            }
            passed = sum(int(cycles < m) for m in ms)
            failures = [
                {
                    "group": self.cap_for(m),
                    "test": "cycles",
                    "message": (
                        f"current={cycles} cycles ({speedup}x baseline); reduce "
                        f"KernelBuilder.build_kernel below {m} cycles to clear this bar."
                    ),
                }
                for m in ms
                if cycles >= m
            ]
        else:
            score, speedup, passed = 0.0, 0.0, 0
            by_group = {
                self.cap_for(m): {"total": 1, "passed": 0, "failed": 1} for m in ms
            }
            failures = [
                {
                    "group": self.cap_for(ms[0]),
                    "test": "correctness",
                    "message": error
                    or "kernel output is incorrect; fix build_kernel before optimizing.",
                }
            ]
        extra = {
            "cycles": cycles,
            "baseline": self.BASELINE,
            "target": self.TARGET,
            "speedup": speedup,
            "correct": bool(correct),
            "milestones": list(ms),
            "milestones_passed": passed,
        }
        return EvalResult(
            score=score,
            passed=passed,
            total=len(ms),
            pass_at_1=score,
            wall_ms=wall_ms,
            failures=failures,
            by_group=by_group,
            error=error,
            extra=extra,
        )

    def _score(self, cycles: int) -> float:
        """Higher-is-better: 0 at baseline, 1 at target, log scale in between."""
        lo, hi = math.log(self.TARGET), math.log(self.BASELINE)
        frac = (hi - math.log(max(1, cycles))) / (hi - lo)
        return max(0.0, min(1.0, frac))


_SPEEDKIT_RE = re.compile(r"SPEEDKIT_RESULT:\s*(\{.*\})")


class SpeedupEvaluator:
    """Grade a suite of naive functions by correctness plus measured speedup.

    Runs the suite's frozen grader (tests/grade.py, read-only), which checks each
    candidate function against a reference on random inputs and times both, then prints
    one ``SPEEDKIT_RESULT: {json}`` line. A function is "optimized" once it is correct
    AND at least ``TARGET`` x faster, so ``score`` is the fraction of the suite
    optimized, ``by_group`` is per-function (the signal the BYO loop re-attempts on),
    and ``extra`` carries the mean speedup for the cockpit gauge. The grader runs under
    ``uv run --with numpy`` so candidates may use numpy without it being a project dep.
    """

    def __init__(
        self,
        functions,
        timeout_s: int = 180,
        target: float = 2.0,
        deps=("numpy",),
    ) -> None:
        self.functions = list(functions)
        self.timeout_s = timeout_s
        self.target = float(target)  # a function counts as optimized at >= target x
        self.deps = list(deps)  # extra packages the grader needs (passed to uv --with)

    def evaluate(self, workspace: Path, *, seed: Optional[int] = None) -> EvalResult:
        workspace = Path(workspace).resolve()
        grader = workspace / "tests" / "grade.py"
        n = len(self.functions)
        if not grader.exists():
            return EvalResult(0.0, 0, n, error=f"grader not found at {grader}")
        cmd = ["uv", "run"]
        for dep in self.deps:
            cmd += ["--with", dep]
        cmd += ["python", "tests/grade.py"]
        t0 = time.perf_counter()
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(workspace),
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
            )
        except subprocess.TimeoutExpired:
            return EvalResult(0.0, 0, n, error=f"grader timed out after {self.timeout_s}s")
        except OSError as exc:
            return EvalResult(0.0, 0, n, error=f"failed to run grader: {exc}")
        wall_ms = int((time.perf_counter() - t0) * 1000)
        out = f"{proc.stdout or ''}\n{proc.stderr or ''}"
        m = _SPEEDKIT_RE.search(out)
        if not m:
            tail = (proc.stderr or "").strip().replace("\n", " ")[-180:]
            return EvalResult(
                0.0, 0, n, wall_ms=wall_ms,
                error=f"no SPEEDKIT_RESULT; grader said: {tail}",
            )
        try:
            res = json.loads(m.group(1))
        except ValueError:
            return EvalResult(0.0, 0, n, wall_ms=wall_ms, error="bad SPEEDKIT_RESULT json")

        by_group: dict[str, dict[str, int]] = {}
        failures: list[dict[str, Any]] = []
        speedups: list[float] = []
        passed = 0
        for fn in self.functions:
            r = res.get(fn, {}) if isinstance(res, dict) else {}
            correct = bool(r.get("correct"))
            speedup = float(r.get("speedup", 0.0) or 0.0)
            ok = correct and speedup >= self.target
            by_group[fn] = {"total": 1, "passed": int(ok), "failed": int(not ok)}
            if correct:
                speedups.append(speedup)
            if ok:
                passed += 1
            else:
                detail = "" if correct else " and its OUTPUT IS INCORRECT"
                failures.append({
                    "group": fn,
                    "test": "speed",
                    "message": (
                        f"{fn} is {speedup}x faster{detail}; make it at least "
                        f"{self.target}x faster while keeping the output identical."
                    ),
                })
        score = passed / n if n else 0.0
        mean_speedup = round(sum(speedups) / len(speedups), 2) if speedups else 0.0
        extra = {
            "mean_speedup": mean_speedup,
            "optimized": passed,
            "functions": n,
            "target": self.target,
            "per_fn": res if isinstance(res, dict) else {},
        }
        return EvalResult(
            score=score, passed=passed, total=n, pass_at_1=score, wall_ms=wall_ms,
            failures=failures, by_group=by_group, error="", extra=extra,
        )
