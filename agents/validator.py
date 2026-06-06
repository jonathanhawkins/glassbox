"""Validator (skeleton): run the oracle over the accumulated capabilities.

The validator runs the oracle diff (Rust token ids vs the tiktoken gpt2
fixtures) gated on the capability set the workers have accumulated, produces an
exact-match accuracy, logs a Weave Evaluation, records the planner-version score
on the leaderboard, and emits validation_passed / validation_failed. Failures
should bounce back as new beads (plan_gap_found / bead_injected) in the next
phase. For now this is a clean signature + a placeholder estimator so the rest
of the pipeline (events, leaderboard) can be wired and demoed.

Interface the next phase will build on:
    validate(run_id, planner_version, caps) -> dict  (accuracy + pass info)
"""
from __future__ import annotations

from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import bus, worker  # noqa: E402

# Capabilities the oracle needs before encode can match exactly. Used by the
# placeholder estimator; the real validator will shell out to the harness.
_ENCODE_CRITICAL = {"merges", "byte_level", "regex", "special", "encode"}


def _estimate_accuracy(caps: set[str]) -> float:
    """Placeholder accuracy proxy from the accumulated capability set.

    NOT the real oracle. The real validator runs harness/ over the corpus and
    diffs token ids. This proxy lets the curve move while the harness is wired:
    fraction of encode-critical capabilities present.
    """
    if not _ENCODE_CRITICAL:
        return 0.0
    have = len(_ENCODE_CRITICAL & caps)
    return round(have / len(_ENCODE_CRITICAL), 4)


@weave.op()
def validate(
    run_id: str,
    planner_version: int = 1,
    caps: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Grade the run, record the leaderboard score, emit a validation event.

    Skeleton: uses a capability-based accuracy proxy instead of the real oracle
    diff. Records the score on glassbox:planner_scores and emits
    validation_passed/failed so the cockpit curve and leaderboard light up.
    """
    bus.set_agent_status(run_id, "validator", "working", planner_version=planner_version)

    if caps is None:
        caps = worker.accumulated_capabilities(run_id)

    accuracy = _estimate_accuracy(set(caps))
    passed = accuracy >= 1.0

    bus.set_planner_score(planner_version, accuracy)

    bus.emit_type(
        "validation_passed" if passed else "validation_failed",
        run_id,
        planner_version=planner_version,
        agent="validator",
        title=f"accuracy={accuracy}",
        payload={"accuracy": accuracy, "pass_at_1": passed, "caps": sorted(caps), "oracle": "placeholder"},
    )
    bus.set_agent_status(
        run_id,
        "validator",
        "done" if passed else "failed",
        planner_version=planner_version,
    )
    return {"accuracy": accuracy, "passed": passed, "caps": sorted(caps)}
