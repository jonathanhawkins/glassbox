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

import os
import time
from typing import Any

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from contract.events import RUN_META_PREFIX  # noqa: E402

from . import beads, bus  # noqa: E402


def pace_ms() -> int:
    """Pace delay (ms) for a watchable board, from env GLASSBOX_PACE_MS.

    Default 0 (the overnight loop runs flat out). The demo sets e.g. 700 so the
    coordinator -> worker -> done transitions are visibly in flight on the board.
    Invalid values fall back to 0.
    """
    try:
        return max(0, int(os.environ.get("GLASSBOX_PACE_MS", "0")))
    except (TypeError, ValueError):
        return 0


def _pace_sleep() -> None:
    """Sleep the configured pace, if any (no-op when GLASSBOX_PACE_MS is 0)."""
    ms = pace_ms()
    if ms > 0:
        time.sleep(ms / 1000.0)


def _caps_key(run_id: str) -> str:
    """Redis set key holding the categories covered so far in this run."""
    return f"{RUN_META_PREFIX}{run_id}:caps"


def accumulated_capabilities(run_id: str) -> set[str]:
    """Return the set of category tags covered so far in this run (from Redis)."""
    members = bus.get_client().smembers(_caps_key(run_id))
    return set(members) if members else set()


def accumulate(run_id: str, capability: str) -> None:
    """Record a bead's category into the run's covered set (no-op if empty)."""
    if capability:
        bus.get_client().sadd(_caps_key(run_id), capability)


@weave.op()
def complete_bead(
    run_id: str,
    bead_id: str,
    capability: str,
    agent: str = "worker-1",
    planner_version: int = 1,
) -> dict[str, Any]:
    """Finish one already-claimed bead: close it and emit ``bead_done``.

    This is the second half of working a bead (the first half is claiming it and
    flipping the worker to ``working``). It does NOT pace or touch agent status,
    so a whole WAVE of beads can be completed together (see run._drain_graph):
    every worker in the wave stays lit while the shared pace elapses, then all
    their beads finish at once. Assumes the capability was already accumulated.
    """
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
    bus.emit_mail(
        run_id,
        agent,
        "validator",
        f"Done: {capability or 'task'}",
        planner_version=planner_version,
        bead_id=bead_id,
        body=f"bead {bead_id.split('-')[-1]} implemented, ready to grade",
        kind="done",
        cap=capability or None,
    )
    return {"bead_id": bead_id, "capability": capability, "caps": caps_sorted}


@weave.op()
def run_bead(
    run_id: str,
    bead_id: str,
    capability: str,
    agent: str = "worker-1",
    planner_version: int = 1,
) -> dict[str, Any]:
    """Implement one bead end to end: claim-light, accumulate, pace, close, done.

    Records the bead's capability into the run's Redis set, emits agent_status
    ``working`` then ``bead_done``, and closes the bead so the dependency graph
    advances and the validator has a covered-category set to grade against. The
    real Rust edits are not performed here; the category gating in the tokenizer
    plus this accumulation is what makes the curve move honestly.

    This is the single-bead convenience (used by the live inject beat). The main
    drain works a whole wave in parallel via ``accumulate`` + ``complete_bead``.
    """
    bus.set_agent_status(run_id, agent, "working", planner_version=planner_version)
    accumulate(run_id, capability)

    # Pace the bead in flight so the cockpit can show the chip move (demo only;
    # 0 in the overnight loop). Sits between bead_claimed -> bead_done.
    _pace_sleep()

    result = complete_bead(run_id, bead_id, capability, agent, planner_version)
    bus.set_agent_status(run_id, agent, "idle", planner_version=planner_version)
    return result
