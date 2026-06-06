"""Improver (skeleton): rewrite the planner skill from the Weave evals.

The improver (meta agent) reads the Weave eval results for the last planner
version, identifies the decomposition gap that capped correctness (for example a
missing or weak capability bead), and rewrites agents/planner/SKILL.md to fix
it, producing planner v(n+1). It emits a ``planner_rewrite`` event so the
cockpit bumps the version badge. The full version (pulling evals via the W&B MCP
server and asking the LLM for a targeted diff) lands in the next phase.

Interface the next phase will build on:
    improve(run_id, planner_version, accuracy, caps) -> dict  (next_version, ...)
    current_skill() -> str
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import bus  # noqa: E402

SKILL_PATH = Path(__file__).resolve().parent / "planner" / "SKILL.md"


def current_skill() -> str:
    """Return the current planner skill text."""
    return SKILL_PATH.read_text(encoding="utf-8")


@weave.op()
def improve(
    run_id: str,
    planner_version: int,
    accuracy: float,
    caps: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Propose planner v(n+1) from the last run's eval signal.

    Skeleton: does not rewrite SKILL.md yet (it would ask the LLM for a targeted
    edit keyed on the failing capability). It computes the next version, emits a
    planner_rewrite event, and returns a small plan-of-record. The real
    implementation reads Weave evals via the W&B MCP server and edits the skill.
    """
    next_version = planner_version + 1
    missing = sorted(set(caps or set()) ^ _all_caps()) if caps is not None else []

    bus.emit_type(
        "planner_rewrite",
        run_id,
        planner_version=next_version,
        agent="improver",
        title=f"planner v{next_version}",
        payload={
            "from_version": planner_version,
            "to_version": next_version,
            "prev_accuracy": accuracy,
            "gap_capabilities": missing,
            "note": "skeleton: SKILL.md rewrite not yet applied",
        },
    )
    return {
        "from_version": planner_version,
        "next_version": next_version,
        "gap_capabilities": missing,
        "applied": False,
    }


def _all_caps() -> set[str]:
    # Imported lazily to avoid a circular import at module load.
    from .planner import CAPABILITIES

    return set(CAPABILITIES)
