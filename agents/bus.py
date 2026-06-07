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
    BEADS_STATE,
    EVENTS_STREAM,
    PLANNER_SCORES,
    SKILL_STATE,
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


def emit_mail(
    run_id: str,
    frm: str,
    to: str,
    subject: str,
    *,
    planner_version: int = 0,
    bead_id: Optional[str] = None,
    body: str = "",
    kind: str = "note",
    cap: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> str:
    """Emit an agent-to-agent message as an ``agent_message`` event.

    A thin, honest messaging layer over the same Redis stream every other event
    rides on: ``frm`` is the sending agent, ``payload.to`` the recipient, plus a
    human subject/body and an optional capability tag. The cockpit's Agent Mail
    drawer reconstructs the whole thread from these (durable in glassbox:events).
    ``kind`` (dispatch/assign/done/grade-pass/grade-fail/rewrite) drives styling.
    Returns the stream entry id, or "" if the emit failed. Mail is cosmetic, so a
    transient Redis error must never abort a real handoff (e.g. strand a worker
    wave mid-drain); failures are swallowed.
    """
    try:
        payload: dict[str, Any] = {"to": to, "subject": subject, "body": body, "kind": kind}
        if cap:
            payload["cap"] = cap
        if extra:
            payload.update(extra)
        return emit_type(
            "agent_message",
            run_id,
            planner_version=planner_version,
            agent=frm,
            bead_id=bead_id,
            title=subject,
            payload=payload,
        )
    except Exception:  # noqa: BLE001 - mail is cosmetic; never break a handoff
        return ""


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


def reset_state() -> dict[str, int]:
    """Clear the live demo state so the next run starts from a clean board.

    Deletes the event stream (which also carries the agent_message mail thread),
    the planner leaderboard, the bead mirror, the skill mirror, and every per-run
    cap set (glassbox:run:*). Returns a small count summary. The cockpit Reset
    button calls this (via the server) between demo runs.
    """
    client = get_client()
    deleted = 0
    # SKILL_STATE is intentionally cleared too: a stale full-coverage mirror
    # surviving a reset is more confusing than a brief gap. The next run re-seeds
    # it (the climb's snapshot / a fresh plan), so the empty window is momentary.
    for key in (EVENTS_STREAM, PLANNER_SCORES, BEADS_STATE, SKILL_STATE):
        deleted += int(client.delete(key) or 0)
    run_keys = list(client.scan_iter(match="glassbox:run:*", count=200))
    if run_keys:
        deleted += int(client.delete(*run_keys) or 0)
    return {"deleted": deleted}
