"""Coordinator: route currently-ready beads to workers round-robin.

Reads ``beads.ready()`` (open AND unblocked beads only) and claims up to one bead
per worker this wave, assigning each to a worker from the pool (worker-1..worker-N)
in round robin. For each claim it emits a ``bead_claimed`` event and flips that
worker's agent_status to ``working``. It only ever claims ids returned by
``beads.ready()``, so it never tries to claim a still-blocked bead (which `br`
would refuse). Capping a wave at one bead per worker is what keeps a worker from
ever holding two tasks at once: any ready beads beyond the pool size wait and are
claimed in the next wave, once a worker frees up by closing its current bead.

The run loop (calling assign_ready repeatedly until the graph drains, with the
worker closing each bead in between) lives in agents/run.py.

Interface other pillars build on:
    assign_ready(run_id, planner_version, workers) -> list[dict]
"""
from __future__ import annotations

from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import beads, bus  # noqa: E402

DEFAULT_WORKERS = ["worker-1", "worker-2", "worker-3", "worker-4"]

# Round-robin cursor that PERSISTS across assign_ready calls (waves), so beads
# are spread across the whole worker pool instead of always restarting at
# worker-1. Without this, a wave with a single ready bead (e.g. the ascii
# foundation, the harness join, or a small climb version) would land on worker-1
# every time; with it, successive beads rotate worker-1 -> worker-2 -> ... and a
# wide wave still fans out across all free workers at once.
_next_worker = 0


def _capability_of(bead: dict[str, Any]) -> str:
    """Extract the capability tag the planner stored in the bead body.

    The planner writes ``capability=<tag>`` into the bead body/description.
    Returns "" if no tag is found.
    """
    body = str(bead.get("description", bead.get("body", "")))
    for token in body.replace("\n", " ").split():
        if token.startswith("capability="):
            return token.split("=", 1)[1]
    return ""


@weave.op()
def assign_ready(
    run_id: str,
    planner_version: int = 1,
    workers: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    """Claim up to one ready bead per worker and hand each to a worker (round robin).

    One pass over ``beads.ready()``, capped at one bead per worker in the pool, so
    no worker is ever handed two tasks in the same wave. For each claimed bead:
    claim it for the next worker in the pool, emit ``bead_claimed``, and set that
    worker's status to ``working``. Any ready beads beyond the pool size are left
    for the next wave (claimed once a worker frees up by closing its current bead).
    Returns the list of {bead_id, title, capability, assignee} assignments made
    this pass (empty when nothing is ready).
    """
    global _next_worker
    pool = workers or DEFAULT_WORKERS
    assignments: list[dict[str, Any]] = []
    claimed_workers: set[str] = set()
    for bead in beads.ready():
        # One task per worker at a time: once every worker in the pool holds a bead
        # this wave, stop. The still-ready beads are claimed in the NEXT wave, after
        # a worker frees up by closing its current bead. This keeps the wave parallel
        # (all free workers light up together) without ever stacking two beads on one
        # worker.
        if len(claimed_workers) >= len(pool):
            break
        bead_id = bead.get("id")
        if not bead_id:
            continue
        # Hand each bead to the next worker in the rotation (persists across
        # waves), so work spreads to whoever is free, not always worker-1.
        assignee = pool[_next_worker % len(pool)]
        _next_worker += 1
        claimed_workers.add(assignee)
        capability = _capability_of(bead)
        beads.claim(bead_id, assignee=assignee)
        bus.emit_type(
            "bead_claimed",
            run_id,
            planner_version=planner_version,
            agent=assignee,
            bead_id=bead_id,
            title=bead.get("title", ""),
            payload={"capability": capability},
        )
        bus.emit_mail(
            run_id,
            "coordinator",
            assignee,
            f"Assigned: {bead.get('title', '') or capability or 'task'}",
            planner_version=planner_version,
            bead_id=bead_id,
            body=f"{capability or 'task'} · {bead_id.split('-')[-1]}",
            kind="assign",
            cap=capability or None,
        )
        bus.set_agent_status(
            run_id, assignee, "working", planner_version=planner_version
        )
        assignments.append(
            {
                "bead_id": bead_id,
                "title": bead.get("title", ""),
                "capability": capability,
                "assignee": assignee,
            }
        )
    return assignments
