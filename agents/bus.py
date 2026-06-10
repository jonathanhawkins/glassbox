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
    emit_mail(run_id, frm, to, subject, ...)  -> str   (real Agent Mail + mirror)
    lease_files(run_id, agent, paths, ...)    -> dict  (real file lease + mirror)
    release_files(run_id, agent, paths, ...)  -> None  (release a worker's leases)
    set_agent_status(run_id, agent, status)   -> str   (emits agent_status)
    set_planner_score(version, accuracy)      -> float (ZADD, returns accuracy)
    get_leaderboard()                         -> list[tuple[int, float]]
"""
from __future__ import annotations

import contextvars
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
    DEFAULT_TASK,
    EVENTS_STREAM,
    PLANNER_META,
    PLANNER_SCORES,
    RUN_META_PREFIX,
    SKILL_STATE,
    make_event,
    planner_meta_key,
    planner_scores_key,
)

_DEFAULT_URL = "redis://127.0.0.1:6379"
_client: Optional["_redis.Redis"] = None

# The build target the current run is working. Every event emitted on this thread
# is stamped with it (see ``emit``) so the cockpit, which is per-task, can drop
# events for any task other than the one it is showing. A ContextVar (not a plain
# global) so concurrent run threads for different tasks never clobber each other:
# each run sets it once at the top of its thread via ``bind_task``.
_current_task: contextvars.ContextVar[str] = contextvars.ContextVar(
    "glassbox_task", default=DEFAULT_TASK
)


def bind_task(task: Optional[str]) -> None:
    """Set the active build target for events emitted on this thread.

    Call once at the start of a run (run_cycle / improve_loop / live beat). Every
    subsequent ``emit`` on this thread stamps the event with this task unless the
    event already carries one.
    """
    _current_task.set((task or DEFAULT_TASK).strip() or DEFAULT_TASK)


def current_task() -> str:
    """The build target events are currently stamped with on this thread."""
    return _current_task.get()


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

    Stamps the thread's active task (set by ``bind_task``) unless the envelope
    already carries one, so the per-task cockpit can filter the global stream.
    """
    event.setdefault("task", current_task())
    return get_client().xadd(EVENTS_STREAM, {"data": json.dumps(event)})


def emit_type(
    type: str,
    run_id: str,
    *,
    task: Optional[str] = None,
    planner_version: int = 0,
    agent: str = "system",
    bead_id: Optional[str] = None,
    title: str = "",
    payload: Optional[dict[str, Any]] = None,
) -> str:
    """Build a canonical event with make_event and emit it. Returns entry id.

    ``task`` defaults to the thread's active build target (set by ``bind_task``),
    so callers do not have to thread it through every emit; pass it only to stamp
    an event for a task other than the one this run is bound to.
    """
    event = make_event(
        type,
        run_id,
        task=task or current_task(),
        planner_version=planner_version,
        agent=agent,
        bead_id=bead_id,
        title=title,
        payload=payload,
    )
    return emit(event)


# Map a mail kind to Agent Mail importance (only grade-fail is escalated).
_IMPORTANCE_BY_KIND = {"grade-fail": "high"}


def _basename(path: str) -> str:
    """Last path segment, for compact file-lease subjects."""
    return str(path).rsplit("/", 1)[-1]


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
    """Send a real Agent Mail message at an agent handoff and mirror it to Redis.

    ``frm``/``to`` are logical swarm roles (planner, coordinator, worker-N,
    validator, improver). The message is sent over the genuine Agent Mail server
    (agentmail.send) between the roles' registered identities, then mirrored as an
    ``agent_message`` event on the same Redis stream every other event rides on,
    so the cockpit's Agent Mail drawer reconstructs the whole thread (durable in
    glassbox:events) and can expand any row into its real Agent Mail record (the
    message id, identities, thread, verified flag). ``kind`` (dispatch/assign/
    done/grade-pass/grade-fail/rewrite/lease) drives styling.

    Agent Mail is the coordination fabric but must never block a handoff: if the
    server is unavailable the real send is skipped and the row is mirrored with
    ``real=False`` (the swarm behaves exactly as before). Returns the stream entry
    id, or "" if even the mirror failed.
    """
    payload: dict[str, Any] = {"to": to, "subject": subject, "body": body, "kind": kind}
    if cap:
        payload["cap"] = cap
    if extra:
        payload.update(extra)

    # Real Agent Mail send (best effort). The genuine message metadata rides back
    # into the payload so the cockpit can reveal it; a failure degrades to mirror.
    try:
        from . import agentmail

        sent = agentmail.send(
            frm,
            to,
            subject,
            body or subject,
            importance=_IMPORTANCE_BY_KIND.get(kind, "normal"),
            topic=run_id,
        )
    except Exception:  # noqa: BLE001 - mail must never break a handoff
        sent = None
    if sent:
        payload["real"] = True
        payload["mail_id"] = sent.get("mail_id")
        payload["thread_id"] = sent.get("thread_id")
        payload["from_id"] = sent.get("from_identity")
        payload["to_id"] = sent.get("to_identity")
        payload["importance"] = sent.get("importance")
        payload["verified"] = sent.get("verified")
        if sent.get("project_slug"):
            payload["project_slug"] = sent["project_slug"]
    else:
        payload.setdefault("real", False)

    try:
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


def lease_files(
    run_id: str,
    agent: str,
    paths: list[str],
    *,
    planner_version: int = 0,
    reason: str = "",
    bead_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Acquire real advisory Agent Mail file leases for ``agent`` and mirror them.

    Workers call this before editing the shared workspace so file ownership is
    signaled the way the PRD intends (Agent Mail advisory leases). The grant
    (granted reservations + any conflicts) is mirrored as a ``lease`` mail row, so
    the cockpit shows "worker-N reserved <file>" and can expand it into the real
    reservation (path, exclusive, TTL/expiry). Returns the grant dict or None.
    Advisory and never fatal: failures still emit a mirror row.
    """
    grant: Optional[dict[str, Any]] = None
    try:
        from . import agentmail

        grant = agentmail.reserve(agent, paths, reason=reason)
    except Exception:  # noqa: BLE001
        grant = None

    shown = ", ".join(_basename(p) for p in paths) or "files"
    payload: dict[str, Any] = {
        "to": "all",
        "subject": f"Reserved {shown}",
        "body": f"advisory file lease while implementing {reason or 'this bead'}",
        "kind": "lease",
    }
    if reason:
        payload["cap"] = reason
    if grant:
        payload["real"] = True
        payload["leases"] = grant.get("granted") or []
        conflicts = grant.get("conflicts") or []
        if conflicts:
            payload["conflicts"] = conflicts
    else:
        payload["real"] = False
        payload["leases"] = [{"path": p} for p in paths]

    try:
        emit_type(
            "agent_message",
            run_id,
            planner_version=planner_version,
            agent=agent,
            bead_id=bead_id,
            title=payload["subject"],
            payload=payload,
        )
    except Exception:  # noqa: BLE001
        pass
    return grant


def release_files(
    run_id: str,
    agent: str,
    paths: Optional[list[str]] = None,
    *,
    planner_version: int = 0,
) -> None:
    """Release ``agent``'s advisory file leases (best effort, silent)."""
    try:
        from . import agentmail

        agentmail.release(agent, paths)
    except Exception:  # noqa: BLE001
        pass


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


def set_planner_score(version: int, accuracy: float, task: str = "tokenizer") -> float:
    """ZADD the planner version's accuracy onto the task's leaderboard sorted set.

    member = str(version), score = accuracy (0..1), key = per-task (so the tokenizer
    and the textkit keep separate curves). Drives the climbing correctness curve and
    the leaderboard in the cockpit. Returns accuracy.
    """
    get_client().zadd(planner_scores_key(task), {str(version): float(accuracy)})
    return float(accuracy)


def get_leaderboard(task: str = "tokenizer") -> list[tuple[int, float]]:
    """Return the task's [(version, accuracy), ...] sorted by accuracy ascending."""
    rows = get_client().zrange(planner_scores_key(task), 0, -1, withscores=True)
    out: list[tuple[int, float]] = []
    for member, score in rows:
        try:
            out.append((int(member), float(score)))
        except (TypeError, ValueError):
            continue
    return out


def set_planner_meta(task: str, version: int, **fields: Any) -> dict[str, Any]:
    """Merge per-version metadata into the task's planner-meta hash (version indexed).

    The companion to ``set_planner_score``: the sorted set holds the authoritative
    accuracy/ordering, this holds the richer per-version detail the cockpit leaderboard
    shows (accuracy, wall_ms, weave_eval_url, status, added_category, gap_source). Two
    writers contribute: the validator writes the grade, the improver writes the
    category that produced the version, so this READS the existing field and MERGES the
    new fields in (the improve loop is single-threaded, so the read-modify-write is
    safe). ``None`` values are dropped so a writer never blanks another's field.
    Best-effort: returns the merged record, or {} if Redis is unreachable.
    """
    key = planner_meta_key(task)
    field = str(int(version))
    clean = {k: v for k, v in fields.items() if v is not None}
    try:
        client = get_client()
        existing_raw = client.hget(key, field)
        record: dict[str, Any] = {}
        if existing_raw:
            try:
                record = json.loads(existing_raw)
            except (TypeError, ValueError):
                record = {}
        record.update(clean)
        record["version"] = int(version)
        client.hset(key, field, json.dumps(record))
        return record
    except Exception as exc:  # noqa: BLE001 - leaderboard meta is best-effort
        print(f"[bus] planner meta write skipped: {exc}")
        return {}


def get_planner_meta(task: str = "tokenizer") -> dict[int, dict[str, Any]]:
    """Return {version: {accuracy, added_category, wall_ms, weave_eval_url, ...}}.

    HGETALL the task's planner-meta hash and JSON-parse each field. Tolerant of bad
    rows (skips them) and a missing key (returns {}). The cockpit's /api/leaderboard
    route reads the same hash directly; this is for Python callers (the backend
    /leaderboard endpoint and tests)."""
    out: dict[int, dict[str, Any]] = {}
    try:
        raw = get_client().hgetall(planner_meta_key(task))
    except Exception:  # noqa: BLE001
        return out
    for member, blob in (raw or {}).items():
        try:
            rec = json.loads(blob)
            out[int(member)] = rec if isinstance(rec, dict) else {}
        except (TypeError, ValueError):
            continue
    return out


def integrity_key(task: str = DEFAULT_TASK) -> str:
    """The per-task integrity key (a Redis hash for the cockpit's integrity panel)."""
    t = (task or DEFAULT_TASK).strip() or DEFAULT_TASK
    return f"glassbox:integrity:{t}"


def record_integrity_block(task: str, paths: Any) -> None:
    """Record that the worker's allow-list blocked a forbidden edit.

    The BYO worker may only write its ``edit_globs`` and never the read-only test
    paths; when a model reply proposes an out-of-bounds file (e.g. a tests/ file or
    the frozen simulator) the edit is dropped and this bumps the per-task ``blocked``
    counter the integrity panel shows. Best-effort: never breaks a run.
    """
    items = [str(p) for p in (paths or []) if p]
    if not items:
        return
    try:
        client = get_client()
        key = integrity_key(task)
        client.hincrby(key, "blocked", len(items))
        client.hset(key, "last_blocked", ", ".join(sorted(set(items))[:5]))
    except Exception as exc:  # noqa: BLE001 - integrity telemetry is best-effort
        print(f"[bus] integrity block record skipped: {exc}")


def get_integrity(task: str = DEFAULT_TASK) -> dict[str, Any]:
    """Read the per-task integrity counters ({blocked, last_blocked}). Best-effort."""
    try:
        raw = get_client().hgetall(integrity_key(task)) or {}
    except Exception:  # noqa: BLE001
        return {"blocked": 0, "last_blocked": ""}
    return {
        "blocked": int(raw.get("blocked", 0) or 0),
        "last_blocked": raw.get("last_blocked", "") or "",
    }


def clear_integrity(task: str = DEFAULT_TASK) -> None:
    """Drop a task's integrity counters (called at the start of a climb)."""
    try:
        get_client().delete(integrity_key(task))
    except Exception as exc:  # noqa: BLE001
        print(f"[bus] clear_integrity skipped: {exc}")


def clear_leaderboard(task: str = DEFAULT_TASK) -> int:
    """Delete ONE task's leaderboard scores and per-version metadata.

    Called at the START of a climb so the curve and leaderboard reflect ONLY the
    current climb's v1..vN, never a longer prior climb's trailing versions. This is
    the leaderboard analog of the skill/workspace history reset improve_loop already
    does, and unlike reset_state() it is scoped to a single task (the other task's
    curve is untouched). Returns the number of keys deleted. Best-effort.
    """
    try:
        return int(
            get_client().delete(planner_scores_key(task), planner_meta_key(task)) or 0
        )
    except Exception as exc:  # noqa: BLE001 - never let a cleanup break a climb
        print(f"[bus] clear_leaderboard skipped: {exc}")
        return 0


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
    for key in (EVENTS_STREAM, BEADS_STATE, SKILL_STATE):
        deleted += int(client.delete(key) or 0)
    # Every per-task leaderboard (glassbox:planner_scores:{task}) plus the legacy
    # base key, so a stale task's curve never survives a reset.
    score_keys = list(client.scan_iter(match=f"{PLANNER_SCORES}*", count=200))
    if score_keys:
        deleted += int(client.delete(*score_keys) or 0)
    # Every per-task version-metadata hash (glassbox:planner_meta:{task}), so the
    # leaderboard rows clear alongside their curve.
    meta_keys = list(client.scan_iter(match=f"{PLANNER_META}*", count=200))
    if meta_keys:
        deleted += int(client.delete(*meta_keys) or 0)
    run_keys = list(client.scan_iter(match=f"{RUN_META_PREFIX}*", count=200))
    if run_keys:
        deleted += int(client.delete(*run_keys) or 0)
    return {"deleted": deleted}
