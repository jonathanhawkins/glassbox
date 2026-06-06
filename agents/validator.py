"""Validator: run the REAL oracle over the run's covered categories.

The validator grades a run by shelling the Rust tokenizer over the fixture corpus
(``harness.run_oracle``) gated on the set of categories the workers have covered
in this run. Accuracy is the exact-match fraction the oracle reports (which, by
construction of the category gating, equals the share of the corpus whose
category is covered). It records that accuracy on the planner-version leaderboard
and emits ``validation_passed`` (accuracy > 0) or ``validation_failed``, with a
payload carrying the accuracy, the covered caps, and the failing categories.

Interface other pillars build on:
    validate(run_id, planner_version, caps) -> dict
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import bus, worker  # noqa: E402
from .planner import CATEGORY_ORDER, STRUCTURAL  # noqa: E402

# Import the oracle lazily-safely at module load; harness is a sibling package.
from harness.oracle import run_oracle  # noqa: E402

# The scoring categories the oracle understands (structural tags do not score).
_SCORING_CATEGORIES = set(CATEGORY_ORDER)


def _failed_categories(
    caps: set[str], failed_examples: list[dict[str, Any]]
) -> list[str]:
    """Derive which categories are still failing.

    First try to read a ``category`` field off the oracle's failed_examples; if
    those are present, the failing categories are exactly the categories seen
    among the failures. Otherwise fall back to the scoring categories NOT in the
    covered set (which is what the gating guarantees fails).
    """
    seen: set[str] = set()
    for ex in failed_examples or []:
        cat = ex.get("category") if isinstance(ex, dict) else None
        if isinstance(cat, str) and cat:
            seen.add(cat)
    if seen:
        return sorted(seen)
    return sorted(_SCORING_CATEGORIES - set(caps))


@weave.op()
def validate(
    run_id: str,
    planner_version: int = 1,
    caps: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """Grade the run with the real oracle, record the score, emit a result event.

    ``caps`` defaults to the categories accumulated for this run (the Redis set
    glassbox:run:<run_id>:caps). The oracle is run gated on the SCORING subset of
    those caps (structural tags like ``harness`` are dropped, as they have no
    scoring effect). The resulting accuracy is ZADDed onto the leaderboard for
    ``planner_version`` and a validation_passed/failed event is emitted with
    payload {accuracy, caps, failed_categories}.

    Returns the oracle dict augmented with ``planner_version``.
    """
    bus.set_agent_status(
        run_id, "validator", "working", planner_version=planner_version
    )

    if caps is None:
        caps = worker.accumulated_capabilities(run_id)
    caps = set(caps)

    # Only the scoring categories gate the oracle. Drop structural tags so a run
    # that only covered the harness bead does not accidentally request a
    # non-scoring cap (the oracle treats unknown/structural names as no-ops, but
    # being explicit keeps the reported caps meaningful).
    scoring_caps = sorted(caps & _SCORING_CATEGORIES)

    # The oracle treats an empty/None caps list as "all categories" (exact, 1.0),
    # which is the right default for a no-caps CLI invocation. But for the
    # validator, zero covered categories must mean ZERO accuracy, not full. So
    # when no scoring category is covered we pass an explicit non-scoring sentinel
    # ("__none__"): the tokenizer enables nothing and every line fails exact
    # match, giving accuracy 0 and the validation_failed path.
    oracle_caps = scoring_caps if scoring_caps else ["__none__"]
    result = run_oracle(caps=oracle_caps)
    accuracy = float(result.get("accuracy", 0.0))
    passed = accuracy > 0.0

    bus.set_planner_score(planner_version, accuracy)

    failed_categories = _failed_categories(caps, result.get("failed_examples", []))

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
            "passed_lines": result.get("passed", 0),
            "total_lines": result.get("total", 0),
            "oracle_error": result.get("error", ""),
        },
    )
    bus.set_agent_status(
        run_id,
        "validator",
        "done" if accuracy >= 1.0 else ("idle" if passed else "failed"),
        planner_version=planner_version,
    )

    out = dict(result)
    out["planner_version"] = planner_version
    out["failed_categories"] = failed_categories
    return out
