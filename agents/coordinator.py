"""Coordinator (skeleton): route ready beads to available workers.

Reads ``beads.ready()`` and assigns each unblocked bead to a free worker,
emitting a ``bead_claimed`` event and flipping the worker's agent_status to
working. The full routing loop (waiting on dependencies to clear, balancing
across worker-1..worker-4, posting assignments over Agent Mail) lands in the
next phase. For now this is a clean signature + minimal body.

Interface the next phase will build on:
    assign_ready(run_id, planner_version, workers) -> list[dict]
"""
from __future__ import annotations

from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import beads, bus  # noqa: E402

DEFAULT_WORKERS = ["worker-1", "worker-2", "worker-3", "worker-4"]


@weave.op()
def assign_ready(
    run_id: str,
    planner_version: int = 1,
    workers: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    """Claim each currently-ready bead and hand it to a worker (round robin).

    Skeleton: claims ready beads and emits bead_claimed; does not yet loop until
    the graph drains or coordinate file leases over Agent Mail. Returns the list
    of {bead_id, title, assignee} assignments made this pass.
    """
    pool = workers or DEFAULT_WORKERS
    assignments: list[dict[str, Any]] = []
    for i, bead in enumerate(beads.ready()):
        bead_id = bead.get("id")
        if not bead_id:
            continue
        assignee = pool[i % len(pool)]
        beads.claim(bead_id, assignee=assignee)
        bus.emit_type(
            "bead_claimed",
            run_id,
            planner_version=planner_version,
            agent=assignee,
            bead_id=bead_id,
            title=bead.get("title", ""),
            payload={"capability": _capability_of(bead)},
        )
        bus.set_agent_status(run_id, assignee, "working", planner_version=planner_version)
        assignments.append({"bead_id": bead_id, "title": bead.get("title", ""), "assignee": assignee})
    return assignments


def _capability_of(bead: dict[str, Any]) -> str:
    """Best-effort extract the capability tag from a bead's body/description.

    The planner stores ``capability=<tag>`` in the bead body. The next phase may
    instead carry it on the bead_created payload mirror in Redis.
    """
    body = str(bead.get("description", bead.get("body", "")))
    for token in body.replace("\n", " ").split():
        if token.startswith("capability="):
            return token.split("=", 1)[1]
    return ""
