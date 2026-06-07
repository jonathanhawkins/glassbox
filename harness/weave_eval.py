"""The live Weave Evaluation seam: log a real ``weave.Evaluation`` per planner
version, and read it back.

This is the general, task-aware Weave Evaluation that grades on the LIVE path
(the validator calls ``log_planner_eval`` right after it grades the rebuilt
artifact with the task's checkable evaluator). It is evaluator-agnostic: it logs
whatever uniform ``EvalResult`` the evaluator produced (the tokenizer oracle diff
or the pytest runner), so both tasks get a real Evaluation with zero task-specific
code here.

Shape (PRD section 6: "a Weave Evaluation whose scorer is the oracle diff; each
planner version is a row"):
  - ONE Evaluation per task, named ``{task}-correctness``, so versions compare as
    rows of the SAME Evaluation in the Weave UI (the leaderboard / climbing curve).
  - ``model = planner_v{n}`` is the row identity, so each planner version is a row.
  - One scored example per evaluator GROUP (input category for the tokenizer, test
    module for pytest), scored by the real pass fraction, so the per-group signal
    the improver steers on is graded by Weave, not just asserted. This is the
    "summary per version" granularity: a handful of rows per version, cheap and
    stage-safe (NOT one row per corpus line).
  - A summary row carrying accuracy, pass@1, efficiency (wall_ms), and the full
    per-group breakdown, so the improver can read the gaps back FROM Weave.

``read_planner_eval`` is the read side the improver uses: it flushes pending writes,
then queries the most recent ``Evaluation.evaluate`` call for ``{task}-correctness``
and returns the version's summary dict (``accuracy`` + ``by_group``). Weave is
eventually consistent, so it retries briefly; callers fall back to their in-process
signal if it returns None.

EVERYTHING here is best-effort: Weave is observability, so a missing client, an
auth error, or a flaky network must NEVER raise into the swarm. Writers return a
status dict; the reader returns None.

Interface other pillars build on:
    log_planner_eval(task_name, planner_version, result, *, caps, extra) -> dict
    read_planner_eval(task_name, planner_version, *, retries, delay) -> dict | None
"""
from __future__ import annotations

import os
import time
from typing import Any, Optional

# A stable Evaluation name PER TASK: every planner version logs into the same
# Evaluation (varying only the model = planner_vN), so the Weave UI shows v1..vN as
# comparable rows / a climbing leaderboard rather than N disconnected evaluations.
EVAL_NAME_TMPL = "{task}-correctness"


def _entity_project() -> str:
    """Resolve ``entity/project`` exactly like agents.llm (a bare project name fails
    with an entity error on this account). Kept local so harness/ never imports
    agents/."""
    entity = os.environ.get("WANDB_ENTITY", "").strip()
    project = os.environ.get(
        "WEAVE_PROJECT", os.environ.get("WANDB_PROJECT", "glassbox")
    ).strip()
    return f"{entity}/{project}" if entity else project


def _weave_url() -> str:
    """Best-effort link to the project's Weave traces."""
    entity = os.environ.get("WANDB_ENTITY", "").strip()
    project = os.environ.get(
        "WEAVE_PROJECT", os.environ.get("WANDB_PROJECT", "glassbox")
    ).strip()
    return f"https://wandb.ai/{entity}/{project}/weave" if entity else (
        f"https://wandb.ai/{project}/weave"
    )


def _client() -> Optional[Any]:
    """The active Weave client, initializing once if needed. None on any failure.

    Prefers an already-initialized client (no network); only calls ``weave.init``
    as a fallback so this module works even if a caller forgot to init. Best-effort:
    a missing key / offline returns None.
    """
    try:
        import weave
    except Exception:
        return None
    try:
        client = weave.get_client()
        if client is not None:
            return client
    except Exception:
        pass
    proj = _entity_project()
    if not proj:
        return None
    try:
        return weave.init(proj)
    except Exception:
        return None


def eval_name_for(task_name: str) -> str:
    """The stable Evaluation name for a task (versions compare as rows under it)."""
    return EVAL_NAME_TMPL.format(task=(task_name or "task"))


def _group_fraction(g: dict[str, Any]) -> tuple[int, int, float]:
    """(passed, total, fraction) from a by_group tally entry, defensively."""
    total = int(g.get("total", 0) or 0)
    passed = int(g.get("passed", 0) or 0)
    frac = (passed / total) if total else 0.0
    return passed, total, frac


def log_planner_eval(
    task_name: str,
    planner_version: int,
    result: Any,
    *,
    caps: Optional[list[str]] = None,
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Log a real ``weave.Evaluation`` for one planner version. Best-effort.

    ``result`` is the uniform ``EvalResult`` the validator just produced (it carries
    ``score``/``passed``/``total``/``pass_at_1``/``wall_ms``/``by_group``/``error``),
    so this is fully task-agnostic. Logs one scored example per ``by_group`` entry
    plus a summary, under the per-task Evaluation, with ``model = planner_v{n}``.

    Returns a status dict: ``{logged, eval_name, model, url, summary}`` on success,
    or ``{logged: False, reason}`` if Weave is unavailable. NEVER raises.
    """
    client = _client()
    if client is None:
        return {"logged": False, "reason": "weave client unavailable"}

    try:
        from weave import EvaluationLogger
    except Exception as exc:  # noqa: BLE001
        return {"logged": False, "reason": f"EvaluationLogger import failed: {exc}"}

    eval_name = eval_name_for(task_name)
    model = f"planner_v{int(planner_version)}"
    by_group: dict[str, Any] = dict(getattr(result, "by_group", {}) or {})
    accuracy = float(getattr(result, "score", 0.0) or 0.0)
    pass_at_1 = float(getattr(result, "pass_at_1", accuracy) or 0.0)
    summary = {
        "task": task_name,
        "planner_version": int(planner_version),
        "accuracy": accuracy,
        "pass_at_1": pass_at_1,
        "passed": int(getattr(result, "passed", 0) or 0),
        "total": int(getattr(result, "total", 0) or 0),
        "wall_ms": int(getattr(result, "wall_ms", 0) or 0),
        "by_group": {k: dict(v) for k, v in by_group.items()},
        "caps": sorted(caps) if caps else [],
        "error": str(getattr(result, "error", "") or ""),
    }
    if extra:
        summary.update(extra)

    el: Optional[Any] = None
    finalized = False
    try:
        el = EvaluationLogger(
            name=eval_name,
            model=model,
            dataset=f"{task_name}-corpus",
            # Secondary match key for the reader, and a clean filter in the UI.
            eval_attributes={"task": task_name, "planner_version": int(planner_version)},
        )
        # One scored row per evaluator group (cheap, ~handful per version). The
        # scorer IS the real check: pass_fraction over that group's items, and
        # all_pass (the exact-match / fully-green bar) for that group.
        for group in sorted(by_group):
            passed, total, frac = _group_fraction(by_group.get(group) or {})
            el.log_example(
                inputs={"group": group, "total": total},
                output={"passed": passed, "failed": max(0, total - passed)},
                scores={"pass_fraction": float(frac), "all_pass": bool(total and passed == total)},
            )
        # log_summary finalizes the Evaluation; our dict lands at output["output"].
        el.log_summary(summary)
        finalized = True
    except Exception as exc:  # noqa: BLE001 - Weave is best-effort
        return {"logged": False, "reason": f"{type(exc).__name__}: {exc}"}
    finally:
        if el is not None and not finalized:
            try:
                el.finish()
            except Exception:
                pass

    url: Optional[str] = None
    try:
        url = el.ui_url
    except Exception:
        url = None
    return {
        "logged": True,
        "eval_name": eval_name,
        "model": model,
        "url": url or _weave_url(),
        "summary": summary,
    }


def _scan_for_summary(
    client: Any, eval_name: str, task_name: str, want_version: int, scan: int
) -> Optional[dict[str, Any]]:
    """Find the most recent matching Evaluation.evaluate call's summary, or None.

    Scans the ``scan`` most recent calls (newest first), matching the per-task
    Evaluation by display_name (set to ``eval_name``) or the op name, then reads the
    summary our writer stashed at ``output["output"]`` and confirms it is the
    requested task + version.
    """
    try:
        from weave.trace_server.trace_server_interface import SortBy

        sort_by = [SortBy(field="started_at", direction="desc")]
    except Exception:
        sort_by = None

    # The whole query AND iteration are guarded: CallsIter fetches pages lazily, so a
    # network error can surface mid-loop, and this must never raise into the swarm.
    try:
        calls = client.get_calls(sort_by=sort_by, limit=int(scan))
        for call in calls:
            display = getattr(call, "display_name", "") or ""
            op = getattr(call, "op_name", "") or ""
            if display != eval_name and "Evaluation.evaluate" not in op:
                continue
            out = getattr(call, "output", None)
            if not isinstance(out, dict):
                continue
            # Our writer's summary is nested under "output" (auto_summarize wraps it);
            # tolerate a flat shape too.
            inner = out.get("output")
            summary = inner if isinstance(inner, dict) else out
            if not isinstance(summary, dict):
                continue
            if summary.get("task") != task_name:
                continue
            try:
                if int(summary.get("planner_version", -1)) != int(want_version):
                    continue
            except (TypeError, ValueError):
                continue
            return summary
    except Exception:
        return None
    return None


def read_planner_eval(
    task_name: str,
    planner_version: int,
    *,
    retries: Optional[int] = None,
    delay: Optional[float] = None,
) -> Optional[dict[str, Any]]:
    """Read a planner version's logged Evaluation summary back FROM Weave.

    Returns the summary dict (``accuracy``, ``by_group``, ...) the validator logged
    for ``planner_version`` of ``task_name``, or None if Weave is unavailable or the
    eval is not yet queryable. Flushes pending writes first and retries briefly to
    absorb Weave's read-after-write latency. NEVER raises. Callers fall back to their
    in-process signal on None.

    Tunables (env): GLASSBOX_WEAVE_READ_RETRIES, GLASSBOX_WEAVE_READ_DELAY,
    GLASSBOX_WEAVE_READ_SCAN.
    """
    client = _client()
    if client is None:
        return None

    # Read-after-write of the FRESHEST eval is the latency-sensitive case: Weave
    # needs a few seconds to index a just-logged call. Defaults give a ~9s budget
    # (8 attempts x ~1s), which comfortably covers the observed ~7s lag so the
    # improver genuinely sources from Weave instead of falling back. Tune down for a
    # snappier live climb (the in-process fallback stays correct either way).
    retries = int(
        os.environ.get("GLASSBOX_WEAVE_READ_RETRIES", retries if retries is not None else 8)
    )
    delay = float(
        os.environ.get("GLASSBOX_WEAVE_READ_DELAY", delay if delay is not None else 1.0)
    )
    scan = int(os.environ.get("GLASSBOX_WEAVE_READ_SCAN", 200))
    retries = max(1, retries)
    eval_name = eval_name_for(task_name)

    for attempt in range(retries):
        # Force buffered writes (the just-logged eval) up before each read.
        try:
            client.flush()
        except Exception:
            pass
        try:
            summary = _scan_for_summary(
                client, eval_name, task_name, int(planner_version), scan
            )
        except Exception:
            summary = None
        if summary is not None:
            return summary
        if attempt < retries - 1 and delay > 0:
            time.sleep(delay)
    return None
