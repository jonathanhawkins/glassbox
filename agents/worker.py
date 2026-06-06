"""Worker: implement a bead by adding its category to the run's covered set.

In the capability model a worker "implements" a bead by recording that bead's
category tag against the run. The validator later runs the oracle gated on the
accumulated category set, so as workers close beads the achievable correctness
rises (each category covered makes its slice of the corpus pass exact match).

The accumulated set is persisted to the Redis set ``glassbox:run:<run_id>:caps``
(under the contract's runMetaPrefix) so the validator, the cockpit, and any other
process can read what a run has covered, not just this Python process.

Interface other pillars build on:
    run_bead(run_id, bead_id, capability, agent, planner_version) -> dict
    accumulated_capabilities(run_id) -> set[str]
"""
from __future__ import annotations

from typing import Any

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from contract.events import RUN_META_PREFIX  # noqa: E402

from . import beads, bus  # noqa: E402


def _caps_key(run_id: str) -> str:
    """Redis set key holding the categories covered so far in this run."""
    return f"{RUN_META_PREFIX}{run_id}:caps"


def accumulated_capabilities(run_id: str) -> set[str]:
    """Return the set of category tags covered so far in this run (from Redis)."""
    members = bus.get_client().smembers(_caps_key(run_id))
    return set(members) if members else set()


@weave.op()
def run_bead(
    run_id: str,
    bead_id: str,
    capability: str,
    agent: str = "worker-1",
    planner_version: int = 1,
) -> dict[str, Any]:
    """Implement one bead: add its category, close the bead, emit bead_done.

    Records the bead's capability into the run's Redis set, emits agent_status
    ``working`` then ``bead_done``, and closes the bead so the dependency graph
    advances and the validator has a covered-category set to grade against. The
    real Rust edits are not performed here; the category gating in the tokenizer
    plus this accumulation is what makes the curve move honestly.
    """
    bus.set_agent_status(run_id, agent, "working", planner_version=planner_version)

    if capability:
        bus.get_client().sadd(_caps_key(run_id), capability)

    beads.close(bead_id, reason=f"{agent} implemented capability={capability}")

    caps_sorted = sorted(accumulated_capabilities(run_id))
    bus.emit_type(
        "bead_done",
        run_id,
        planner_version=planner_version,
        agent=agent,
        bead_id=bead_id,
        payload={"capability": capability, "caps": caps_sorted},
    )
    bus.set_agent_status(run_id, agent, "idle", planner_version=planner_version)
    return {"bead_id": bead_id, "capability": capability, "caps": caps_sorted}
