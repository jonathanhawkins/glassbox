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
    PytestEvaluator(...)                         (added with the kata task)
"""
from __future__ import annotations

import os
import subprocess
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


def _group_from_classname(classname: str) -> str:
    """Map a pytest junit classname (e.g. 'tests.test_slug') to a group ('slug')."""
    last = (classname or "").split(".")[-1]
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
            group = _group_from_classname(tc.get("classname", ""))
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
