"""Coordinator: route currently-ready beads to workers round-robin.

Reads ``beads.ready()`` (open AND unblocked beads only) and claims each one,
assigning it to a worker from the pool (worker-1..worker-N) in round robin. For
each claim it emits a ``bead_claimed`` event and flips that worker's agent_status
to ``working``. It only ever claims ids returned by ``beads.ready()``, so it
never tries to claim a still-blocked bead (which `br` would refuse).

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
    """Claim every currently-ready bead and hand it to a worker (round robin).

    One pass over ``beads.ready()``. For each ready bead: claim it for the next
    worker in the pool, emit ``bead_claimed``, and set that worker's status to
    ``working``. Returns the list of {bead_id, title, capability, assignee}
    assignments made this pass (empty when nothing is ready).
    """
    pool = workers or DEFAULT_WORKERS
    assignments: list[dict[str, Any]] = []
    for i, bead in enumerate(beads.ready()):
        bead_id = bead.get("id")
        if not bead_id:
            continue
        assignee = pool[i % len(pool)]
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
