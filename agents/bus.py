"""The Redis event bus and planner leaderboard for Glassbox.

Every agent appends structured events to the Redis Stream ``glassbox:events``
(one stream entry per event, stored under a single field ``data`` holding the
JSON envelope). The cockpit tails this stream to animate the board.

The planner-version leaderboard lives in the sorted set
``glassbox:planner_scores`` (member = str(version), score = accuracy).

Channel names and the event envelope come from the shared contract, never
hardcoded here. See contract/glassbox.contract.json and contract/events.py.

Public interface (other pillars call these):
    emit(event)                               -> str   (stream entry id)
    emit_type(type, run_id, **kw)             -> str   (make_event + emit)
    set_agent_status(run_id, agent, status)   -> str   (emits agent_status)
    set_planner_score(version, accuracy)      -> float (ZADD, returns accuracy)
    get_leaderboard()                         -> list[tuple[int, float]]
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import redis as _redis  # noqa: E402

from contract.events import (  # noqa: E402
    AGENT_STATUS,
    EVENTS_STREAM,
    PLANNER_SCORES,
    make_event,
)

_DEFAULT_URL = "redis://127.0.0.1:6379"
_client: Optional["_redis.Redis"] = None


def get_client() -> "_redis.Redis":
    """Return a process-wide Redis client built from REDIS_URL (decoded str)."""
    global _client
    if _client is None:
        url = os.environ.get("REDIS_URL", _DEFAULT_URL)
        _client = _redis.from_url(url, decode_responses=True)
    return _client


def emit(event: dict[str, Any]) -> str:
    """XADD a fully-formed event envelope onto glassbox:events.

    The envelope is JSON-encoded into the single stream field ``data`` so the
    TS and Python sides agree on the wire shape. Returns the stream entry id.
    """
    return get_client().xadd(EVENTS_STREAM, {"data": json.dumps(event)})


def emit_type(
    type: str,
    run_id: str,
    *,
    planner_version: int = 0,
    agent: str = "system",
    bead_id: Optional[str] = None,
    title: str = "",
    payload: Optional[dict[str, Any]] = None,
) -> str:
    """Build a canonical event with make_event and emit it. Returns entry id."""
    event = make_event(
        type,
        run_id,
        planner_version=planner_version,
        agent=agent,
        bead_id=bead_id,
        title=title,
        payload=payload,
    )
    return emit(event)


def set_agent_status(
    run_id: str,
    agent: str,
    status: str,
    *,
    planner_version: int = 0,
    title: str = "",
    payload: Optional[dict[str, Any]] = None,
) -> str:
    """Emit an agent_status event (status in idle/working/done/failed).

    The board flips an agent lane's status light from this event.
    """
    if status not in AGENT_STATUS:
        raise ValueError(
            f"unknown agent status: {status!r} (allowed: {AGENT_STATUS})"
        )
    body: dict[str, Any] = {"status": status}
    if payload:
        body.update(payload)
    return emit_type(
        "agent_status",
        run_id,
        planner_version=planner_version,
        agent=agent,
        title=title,
        payload=body,
    )


def set_planner_score(version: int, accuracy: float) -> float:
    """ZADD the planner version's accuracy onto the leaderboard sorted set.

    member = str(version), score = accuracy (0..1). Drives the climbing
    correctness curve and the leaderboard in the cockpit. Returns accuracy.
    """
    get_client().zadd(PLANNER_SCORES, {str(version): float(accuracy)})
    return float(accuracy)


def get_leaderboard() -> list[tuple[int, float]]:
    """Return [(version, accuracy), ...] sorted by accuracy ascending."""
    rows = get_client().zrange(PLANNER_SCORES, 0, -1, withscores=True)
    out: list[tuple[int, float]] = []
    for member, score in rows:
        try:
            out.append((int(member), float(score)))
        except (TypeError, ValueError):
            continue
    return out
