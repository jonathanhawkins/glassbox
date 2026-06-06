"""Worker (skeleton): implement a bead by adding its capability to the run.

In the capability model, a worker "implements" a bead by recording that bead's
capability tag against the run. The validator later runs the oracle gated on the
accumulated capability set, so as workers close beads the achievable correctness
rises. The full worker (doing the real Rust edits in an isolated worktree,
coordinating file leases over Agent Mail) lands in the next phase.

Interface the next phase will build on:
    run_bead(run_id, bead_id, capability, agent, planner_version) -> dict
    accumulated_capabilities(run_id) -> set[str]
"""
from __future__ import annotations

from typing import Any

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import beads, bus  # noqa: E402

# Per-run accumulated capabilities. The next phase will mirror this into Redis
# (glassbox:run:<run_id> capabilities) so the validator and cockpit can read it.
_RUN_CAPS: dict[str, set[str]] = {}


def accumulated_capabilities(run_id: str) -> set[str]:
    """Return the set of capability tags implemented so far in this run."""
    return set(_RUN_CAPS.get(run_id, set()))


@weave.op()
def run_bead(
    run_id: str,
    bead_id: str,
    capability: str,
    agent: str = "worker-1",
    planner_version: int = 1,
) -> dict[str, Any]:
    """Implement one bead: add its capability, close the bead, emit bead_done.

    Skeleton: the real Rust work is not done here yet; we just record the
    capability and close the bead so the dependency graph advances and the
    validator has an accumulated capability set to grade against.
    """
    bus.set_agent_status(run_id, agent, "working", planner_version=planner_version)

    if capability:
        _RUN_CAPS.setdefault(run_id, set()).add(capability)

    beads.close(bead_id, reason=f"{agent} implemented capability={capability}")

    bus.emit_type(
        "bead_done",
        run_id,
        planner_version=planner_version,
        agent=agent,
        bead_id=bead_id,
        payload={"capability": capability, "caps": sorted(_RUN_CAPS.get(run_id, set()))},
    )
    bus.set_agent_status(run_id, agent, "idle", planner_version=planner_version)
    return {"bead_id": bead_id, "capability": capability, "caps": sorted(accumulated_capabilities(run_id))}
