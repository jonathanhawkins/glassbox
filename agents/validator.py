"""Validator: grade a run by building and running the real artifact (no gating).

The validator realizes the categories the workers covered this run into the task
workspace source (``task.apply_groups``), builds it (``task.build``), and grades
the rebuilt artifact with the task's checkable evaluator (``task.evaluate``).
Accuracy is the exact-match fraction the evaluator reports over the REAL binary, so
it is a genuine consequence of the source, not a gate. It records that accuracy on
the planner-version leaderboard and emits ``validation_passed`` only on a full
exact-match sweep (accuracy >= 1.0) or ``validation_failed`` otherwise, with a
payload carrying the accuracy, the covered caps, and the failing groups.

Interface other pillars build on:
    validate(task, run_id, planner_version, caps) -> dict
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import bus, llm, worker  # noqa: E402
from harness import weave_eval  # noqa: E402
from harness.evaluator import EvalResult  # noqa: E402

# A run "passes" only on a full exact-match sweep of the corpus: every scored
# line's token IDs equal the oracle's. That is the same bar the improve loop stops
# on (run.py breaks at >= 1.0) and the validator's grade-pass mail uses, so the
# board, the mail, and the loop never disagree about what "passed" means. A partial
# score is a real, climbing number (the curve still rises), but it is NOT a pass:
# it emits validation_failed, so a partial run is never painted green on the board.
PASS_THRESHOLD = 1.0


def _failed_categories(
    caps: set[str], failures: list[dict[str, Any]], scoring: set[str]
) -> list[str]:
    """Derive which groups are still failing.

    First try the ``group`` (or legacy ``category``) field off the evaluator's
    failures; if present, the failing groups are exactly those seen among the
    failures. Otherwise fall back to the scoring groups NOT in the covered set.
    """
    seen: set[str] = set()
    for ex in failures or []:
        cat = (ex.get("group") or ex.get("category")) if isinstance(ex, dict) else None
        if isinstance(cat, str) and cat:
            seen.add(cat)
    if seen:
        return sorted(seen)
    return sorted(scoring - set(caps))


def _failing_breakdown(
    scoring_caps: list[str],
    by_group: dict[str, Any],
    scoring: set[str],
    order: list[str],
) -> list[dict[str, Any]]:
    """Per-group failures (biggest first) for the groups NOT yet covered.

    Reads the evaluator's by_group tally and returns, for each uncovered scoring
    group with failures, {category, failed, total}, sorted by failed desc with a
    canonical tiebreak (the task's group order). This is the data-driven signal the
    improver prioritizes and the cockpit surfaces as "what the eval found". The row
    key stays ``category`` for back-compat with the improver and cockpit; it holds
    the group value.
    """
    covered = set(scoring_caps)
    rows = [
        {
            "category": c,
            "failed": int(v.get("failed", 0)),
            "total": int(v.get("total", 0)),
        }
        for c, v in (by_group or {}).items()
        if c in scoring and c not in covered and int(v.get("failed", 0)) > 0
    ]
    rows.sort(
        key=lambda f: (
            -f["failed"],
            order.index(f["category"]) if f["category"] in order else 99,
        )
    )
    return rows


@weave.op()
def validate(
    task: Any,
    run_id: str,
    planner_version: int = 1,
    caps: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """Grade the run with the real evaluator, record the score, emit a result event.

    ``caps`` defaults to the categories accumulated for this run (the Redis set
    glassbox:run:<run_id>:caps). The covered SCORING subset is realized into the
    task workspace source (``task.apply_groups``), the workspace is built, and the
    rebuilt artifact is graded by the task's checkable evaluator (``task.evaluate``)
    with NO gating, so accuracy is a genuine consequence of the source. The score is
    ZADDed onto the leaderboard for ``planner_version`` and a
    validation_passed/failed event is emitted with payload
    {accuracy, caps, failed_categories, ...}.

    Returns the evaluator payload augmented with ``planner_version``.
    """
    # Ensure Weave is initialized so the Evaluation logged below lands in the
    # project even when validate() runs outside a run_cycle (idempotent, best-effort).
    llm.init_weave()
    bus.set_agent_status(
        run_id, "validator", "working", planner_version=planner_version
    )

    if caps is None:
        caps = worker.accumulated_capabilities(run_id)
    caps = set(caps)

    # The scoring groups for this task and the subset the workers have covered this
    # run. Structural tags (e.g. harness) are not in task.groups, so they drop out.
    scoring = set(task.groups)
    order = list(task.groups)
    scoring_caps = sorted(caps & scoring)

    # Genuine grading: the workers have already authored the workspace source for
    # this run (LLM with deterministic fallback), so the validator just builds and
    # grades the real artifact they produced. Accuracy is a real consequence of the
    # code the agents wrote (no gating): build runs cargo, evaluate runs the
    # exact-match oracle over the corpus.
    build_ok, build_err = task.build()
    # Grade the FULL corpus (deterministic) so the leaderboard climbs monotonically
    # as real coverage grows; the by_group breakdown over the same corpus is the
    # signal the improver steers on.
    if build_ok:
        result = task.evaluate()
    else:
        result = EvalResult(
            score=0.0, passed=0, total=0, error=f"build failed: {build_err[:200]}"
        )
    accuracy = float(result.score)
    passed = accuracy >= PASS_THRESHOLD

    bus.set_planner_score(planner_version, accuracy, task=getattr(task, "name", "tokenizer"))

    # Log a REAL weave.Evaluation for this planner version: one scored row per
    # evaluator group plus a summary (accuracy, pass@1, efficiency, by_group), under
    # the per-task Evaluation with model=planner_v{n}. This is what makes the curve
    # Weave-graded rather than just a Redis number, and it is the summary the
    # improver reads back from Weave to choose its next rewrite. Best-effort: a Weave
    # hiccup must never fail a grade, so the swarm runs on regardless.
    weave_eval_result = weave_eval.log_planner_eval(
        getattr(task, "name", "tokenizer"),
        planner_version,
        result,
        caps=scoring_caps,
    )
    weave_eval_url = (
        weave_eval_result.get("url") if weave_eval_result.get("logged") else None
    )

    # Persist the per-version leaderboard metadata (the grade half): the cockpit's
    # ranked panel reads this back so each row shows accuracy, efficiency, status, and
    # a deep link to THIS version's Weave Evaluation, and survives a page reload (the
    # improver writes the other half, the category that produced the version).
    bus.set_planner_meta(
        getattr(task, "name", "tokenizer"),
        planner_version,
        accuracy=accuracy,
        wall_ms=getattr(result, "wall_ms", 0),
        weave_eval_url=weave_eval_url,
        status="passed" if accuracy >= 1.0 else ("partial" if passed else "failed"),
        covered=scoring_caps,
        # The real per-category pass tally (passed/total per scoring group) from the
        # same graded run. Surfaced so the cockpit can draw the climb matrix with true
        # pass-fraction cells, not just binary covered/not. Small (a handful of groups).
        by_group={k: dict(v) for k, v in (result.by_group or {}).items()},
    )

    # The real per-group failure breakdown (biggest gap first) is the signal the
    # improver prioritizes on and the cockpit surfaces as "what it found".
    failing = _failing_breakdown(scoring_caps, result.by_group, scoring, order)
    failed_categories = [f["category"] for f in failing] or _failed_categories(
        caps, result.failures, scoring
    )

    bus.emit_type(
        "validation_passed" if passed else "validation_failed",
        run_id,
        planner_version=planner_version,
        agent="validator",
        title=f"accuracy={accuracy:.4f}",
        payload={
            "accuracy": accuracy,
            "caps": sorted(caps),
            "scoring_caps": scoring_caps,
            "failed_categories": failed_categories,
            "failing": failing,
            "passed_lines": result.passed,
            "total_lines": result.total,
            "oracle_error": result.error,
            "weave_eval_url": weave_eval_url,
            "weave_eval_logged": bool(weave_eval_result.get("logged")),
        },
    )
    # The grade-pass / grade-fail mail rides the SAME exact-match bar as the
    # validation_passed/failed EVENT above (PASS_THRESHOLD) and the improve loop's
    # "are we done?" test (run.py breaks at >= 1.0 and only rewrites below it), so
    # the board, the mail, and the loop never disagree about what "passed" means. A
    # partial score is "graded, but the improver still has work": a grade-fail mail,
    # a validation_failed event, and a board that shows the gap instead of green.
    pct = round(accuracy * 100)
    if passed:
        bus.emit_mail(
            run_id,
            "validator",
            "improver",
            f"v{planner_version} passed at {pct}%",
            planner_version=planner_version,
            body="all categories green, nothing to fix",
            kind="grade-pass",
        )
    else:
        top = (
            failing[0]["category"]
            if failing
            else (failed_categories[0] if failed_categories else "coverage")
        )
        miss = ", ".join(failed_categories) if failed_categories else top
        bus.emit_mail(
            run_id,
            "validator",
            "improver",
            f"Gap: {top} failing at {pct}%",
            planner_version=planner_version,
            body=f"v{planner_version} scored {pct}%; failing: {miss}",
            kind="grade-fail",
            cap=top,
        )
    # The validator lane goes green ("done") only on a genuine pass; a partial or
    # broken run reads "failed" (not "idle"), matching the validation_failed event
    # the board receives, so the lane never looks settled on a sub-1.0 run.
    bus.set_agent_status(
        run_id,
        "validator",
        "done" if passed else "failed",
        planner_version=planner_version,
    )

    out = result.to_payload()
    out["planner_version"] = planner_version
    out["failed_categories"] = failed_categories
    out["failing"] = failing
    out["weave_eval_url"] = weave_eval_url
    out["weave_eval_logged"] = bool(weave_eval_result.get("logged"))
    return out
