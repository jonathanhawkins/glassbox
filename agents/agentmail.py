"""Real Agent Mail integration for the Glassbox swarm.

The swarm coordinates over a genuine MCP Agent Mail server
(Dicklesworthstone/mcp_agent_mail): every handoff is a real message between
registered agent identities, and workers take advisory file leases on the
workspace files they edit. This is the coordination fabric the PRD calls for
(Agent Mail = "agent-to-agent messaging, identities, advisory file leases").
The Redis ``agent_message`` mirror (see ``bus.emit_mail`` / ``bus.lease_files``)
is what the cockpit animates, now enriched with the real message ids and lease
grants this module returns, so clicking a row in the Agent Mail drawer reveals
the genuine record from the Agent Mail system.

Built for a live demo, so robustness comes first:

  * One persistent ``fastmcp`` client on a dedicated background event loop, so
    the MCP session handshake is paid once per process, not once per message.
  * Hard per-call timeouts and a sticky circuit breaker: if the server is down
    or slow, Agent Mail disables itself for the rest of the process and every
    call no-ops. A coordination hiccup can never stall a real handoff (the
    prime directive). When disabled the swarm runs exactly as before this
    module existed: the Redis mirror still carries the whole thread.
  * Logical swarm roles map to stable, valid adjective+noun identities (the
    server rejects descriptive names like "coordinator"), registered once.

Config (env, all optional; an absent token disables real Agent Mail):
  AGENT_MAIL_URL          default http://127.0.0.1:8765/api/
  AGENT_MAIL_TOKEN        bearer token (required to enable)
  AGENT_MAIL_PROJECT_KEY  default the repo root (absolute path)
  AGENT_MAIL_ENABLED      "0"/"false"/"off" to force off
  AGENT_MAIL_TIMEOUT_S    per-call timeout seconds (default 5)
  AGENT_MAIL_SETUP_TIMEOUT_S  one-time register/ensure timeout (default 12)

Public interface (bus.py is the only caller):
  send(frm, to, subject, body, ...)   -> dict | None   real message id + meta
  reserve(agent, paths, reason, ttl)  -> dict | None    granted leases + conflicts
  release(agent, paths)               -> dict | None
  identity(agent)                     -> str | None      logical -> Agent Mail name
  project_slug()                      -> str | None
  enabled()                           -> bool
"""
from __future__ import annotations

import atexit
import os
import re
import threading
from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

# Repo root is the default project_key (Agent Mail keys a project by the agents'
# working directory). Computed from this file so it is correct from any cwd.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Stable, valid (adjective+noun) Agent Mail identities for each swarm role. The
# server REJECTS descriptive names, so each logical role gets a fixed memorable
# identity; the cockpit keeps showing the logical name and surfaces the real
# identity in the expanded mail detail (proof the message is genuine).
IDENTITIES: dict[str, str] = {
    "planner": "VioletPeak",
    "coordinator": "AmberCompass",
    "worker-1": "BlueLake",
    "worker-2": "GreenMeadow",
    "worker-3": "CrimsonRidge",
    "worker-4": "GoldForge",
    "validator": "SilverGate",
    "improver": "TealGrove",
}

_PROGRAM = "glassbox"
_MODEL = "opus-4.8"

_TOPIC_RE = re.compile(r"[^A-Za-z0-9-]+")

# ---- module state (guarded by _lock) -------------------------------------
_lock = threading.RLock()
_reg_lock = threading.RLock()  # serializes identity registration (git-backed)
_call_lock = threading.Lock()  # serializes tool calls on the one shared client
_loop: Any = None  # asyncio loop running in the background thread
_thread: Any = None
_client: Any = None  # persistent fastmcp Client
_ready = False  # project ensured (identities register lazily, see below)
_disabled: Optional[bool] = None  # None=unknown, True=off (sticky)
_fails = 0
_tokens: dict[str, str] = {}  # logical -> registration_token (verified sends)
_registered: set[str] = set()  # logical roles whose identity is registered
_warm_started = False
_slug: Optional[str] = None  # project slug (for cockpit labeling)
_logged: set[str] = set()


def _timeout() -> float:
    try:
        return max(0.5, float(os.environ.get("AGENT_MAIL_TIMEOUT_S", "5")))
    except (TypeError, ValueError):
        return 5.0


def _setup_timeout() -> float:
    try:
        return max(1.0, float(os.environ.get("AGENT_MAIL_SETUP_TIMEOUT_S", "12")))
    except (TypeError, ValueError):
        return 12.0


def _conf() -> tuple[str, str, str]:
    """(url, token, project_key) from env, with repo-root and localhost defaults."""
    url = (os.environ.get("AGENT_MAIL_URL") or "http://127.0.0.1:8765/api/").strip()
    token = (os.environ.get("AGENT_MAIL_TOKEN") or "").strip()
    project = (os.environ.get("AGENT_MAIL_PROJECT_KEY") or _REPO_ROOT).strip()
    return url, token, project


def _explicitly_off() -> bool:
    return (os.environ.get("AGENT_MAIL_ENABLED") or "").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    )


def _log_once(msg: str) -> None:
    if msg in _logged:
        return
    _logged.add(msg)
    print(f"[agentmail] {msg}")


def _safe_topic(value: str) -> Optional[str]:
    t = _TOPIC_RE.sub("-", str(value)).strip("-")[:64]
    return t or None


# ---- background event loop + persistent client ---------------------------


def _ensure_loop() -> Any:
    global _loop, _thread
    if _loop is not None:
        return _loop
    import asyncio

    with _lock:
        if _loop is not None:
            return _loop
        loop = asyncio.new_event_loop()

        def _run() -> None:
            asyncio.set_event_loop(loop)
            loop.run_forever()

        t = threading.Thread(target=_run, name="agentmail-loop", daemon=True)
        t.start()
        _loop, _thread = loop, t
        return loop


def _submit(coro: Any, timeout: float) -> Any:
    """Run a coroutine on the background loop and block (bounded) for its result.

    All tool calls funnel through here under ``_call_lock`` so exactly one request
    is in flight on the single persistent client at a time. The whole module is
    written assuming that (the background warm-up thread and a foreground send must
    not share the MCP session concurrently). The lock is taken AFTER ``_ensure_loop``
    so it is never held while acquiring ``_lock`` (no lock-order cycle); and
    ``_ensure_identity`` only ever holds ``_reg_lock`` -> ``_call_lock``, never the
    reverse, so this cannot deadlock.
    """
    import asyncio

    loop = _ensure_loop()
    with _call_lock:
        fut = asyncio.run_coroutine_threadsafe(coro, loop)
        return fut.result(timeout=timeout)


async def _aget_client(url: str, token: str) -> Any:
    global _client
    if _client is not None:
        return _client
    from fastmcp import Client

    c = Client(url, auth=token) if token else Client(url)
    await c.__aenter__()
    # Defensive: if another submission established the client while we awaited the
    # handshake, keep the first and close ours (no leaked, unentered client).
    if _client is None:
        _client = c
    else:
        try:
            await c.__aexit__(None, None, None)
        except Exception:  # noqa: BLE001
            pass
    return _client


async def _acall(url: str, token: str, name: str, args: dict[str, Any]) -> Any:
    c = await _aget_client(url, token)
    res = await c.call_tool(name, args)
    return getattr(res, "data", None)


def _ensure_identity(logical: str) -> bool:
    """Register the identity for a logical role (idempotent, cached, serialized).

    Registration is git-backed (~1.5s each), so we register lazily on first use
    instead of paying for all eight upfront. ``_reg_lock`` serializes registrations
    (the server writes them sequentially anyway) and prevents the background
    warm-up from racing a foreground send for the same identity.
    """
    name = IDENTITIES.get(logical)
    if not name:
        return False
    if logical in _registered:
        return True
    with _reg_lock:
        if logical in _registered:
            return True
        if _disabled:
            return False
        url, token, project = _conf()
        try:
            reg = _submit(
                _acall(
                    url,
                    token,
                    "register_agent",
                    {
                        "project_key": project,
                        "program": _PROGRAM,
                        "model": _MODEL,
                        "name": name,
                        "task_description": f"glassbox {logical}",
                    },
                ),
                _setup_timeout(),
            )
            _note_ok()
        except Exception as exc:  # noqa: BLE001
            _note_fail(exc)
            return False
        if isinstance(reg, dict) and reg.get("registration_token"):
            _tokens[logical] = str(reg["registration_token"])
        _registered.add(logical)
        return True


def _warm_in_background() -> None:
    """Register all identities off the hot path so no handoff blocks on setup.

    Kicked once, right after the project is ensured. The planner's first LLM call
    buys enough time for the eight registrations to finish before the coordinator's
    first assignment; if not, the lazy ``_ensure_identity`` in send/reserve covers
    the gap.
    """
    global _warm_started
    if _warm_started:
        return
    _warm_started = True

    def _run() -> None:
        for logical in IDENTITIES:
            if _disabled:
                break
            _ensure_identity(logical)

    threading.Thread(target=_run, name="agentmail-warm", daemon=True).start()


# ---- circuit breaker -----------------------------------------------------


def _note_fail(exc: BaseException) -> None:
    global _fails, _disabled
    _fails += 1
    _log_once(f"call failed ({exc!r})")
    if _fails >= 3:
        _disabled = True
        _log_once("disabled after repeated failures; Redis mirror only from here.")


def _note_ok() -> None:
    global _fails
    _fails = 0


def ensure_ready() -> bool:
    """Ensure the Agent Mail project exists; warm identities in the background.

    Cheap and idempotent: a single ``ensure_project`` call (identities register
    lazily on first use, see ``_ensure_identity``). Returns True when real Agent
    Mail is usable. On the first failure (no token, server down, timeout) it
    disables itself for the process so later calls cost nothing and the swarm
    degrades to the Redis mirror.
    """
    global _ready, _disabled, _slug
    if _ready:
        return True
    with _lock:
        if _ready:
            return True
        if _disabled:
            return False
        url, token, project = _conf()
        if _explicitly_off() or not token:
            _disabled = True
            return False
        try:
            proj = _submit(
                _acall(url, token, "ensure_project", {"human_key": project}),
                _setup_timeout(),
            )
            _slug = proj.get("slug") if isinstance(proj, dict) else None
            _ready = True
            _disabled = False
            _note_ok()
            _log_once(f"connected ({url}); project {_slug or '?'}.")
        except Exception as exc:  # noqa: BLE001 - any failure -> mirror only
            _disabled = True
            _log_once(f"unavailable ({exc!r}); coordinating via Redis mirror only.")
            return False
    # Register all identities off the hot path so the first handoff never blocks.
    _warm_in_background()
    return True


# ---- public surface ------------------------------------------------------


def enabled() -> bool:
    """True once a real session is established and not tripped by the breaker."""
    return bool(_ready and not _disabled)


def identity(agent: str) -> Optional[str]:
    """The real Agent Mail identity for a logical swarm role (or None)."""
    return IDENTITIES.get(agent)


def project_slug() -> Optional[str]:
    return _slug


def _first_delivery(res: Any) -> Optional[dict[str, Any]]:
    if not isinstance(res, dict):
        return None
    dels = res.get("deliveries") or []
    if not dels or not isinstance(dels[0], dict):
        return None
    payload = dels[0].get("payload")
    return payload if isinstance(payload, dict) else None


def send(
    frm: str,
    to: str,
    subject: str,
    body: str,
    *,
    importance: str = "normal",
    thread_id: Optional[str] = None,
    topic: Optional[str] = None,
    ack: bool = False,
) -> Optional[dict[str, Any]]:
    """Send a real Agent Mail message between two swarm roles.

    Returns the genuine message metadata (id, thread, identities, verified) or
    None if Agent Mail is unavailable or either role has no real identity (e.g.
    a broadcast to "all"), in which case the caller mirrors to Redis only.
    """
    if not ensure_ready():
        return None
    frm_id = IDENTITIES.get(frm)
    to_id = IDENTITIES.get(to)
    if not frm_id or not to_id:
        return None
    # Both sender and recipient must be registered before a message can route.
    if not _ensure_identity(frm) or not _ensure_identity(to):
        return None
    url, token, project = _conf()
    args: dict[str, Any] = {
        "project_key": project,
        "sender_name": frm_id,
        "to": [to_id],
        "subject": (subject or "(no subject)")[:200],
        "body_md": body or subject or "",
        "importance": importance,
    }
    if ack:
        args["ack_required"] = True
    if thread_id:
        args["thread_id"] = thread_id
    safe = _safe_topic(topic) if topic else None
    if safe:
        args["topic"] = safe
    tok = _tokens.get(frm)
    if tok:
        args["sender_token"] = tok
    try:
        res = _submit(_acall(url, token, "send_message", args), _timeout())
        _note_ok()
    except Exception as exc:  # noqa: BLE001
        _note_fail(exc)
        return None
    payload = _first_delivery(res)
    if not payload:
        return None
    return {
        "mail_id": payload.get("id"),
        "thread_id": payload.get("thread_id"),
        "topic": payload.get("topic"),
        "from_identity": payload.get("from") or frm_id,
        "to_identity": to_id,
        "importance": payload.get("importance") or importance,
        "verified": bool(res.get("verified_sender")) if isinstance(res, dict) else False,
        "project_slug": _slug,
    }


def reserve(
    agent: str,
    paths: Iterable[str],
    *,
    reason: str = "",
    ttl_seconds: int = 120,
    exclusive: bool = True,
) -> Optional[dict[str, Any]]:
    """Acquire real advisory file leases for a worker on workspace-relative paths.

    Returns ``{granted: [{path, exclusive, expires, reason, id}], conflicts: [...]}``
    or None if Agent Mail is unavailable. Conflicts are reported, not fatal: file
    leases are advisory, so the worker still proceeds (and the cockpit shows the
    contention), exactly as Agent Mail intends.
    """
    plist = [p for p in (paths or []) if p]
    if not plist or not ensure_ready():
        return None
    agent_id = IDENTITIES.get(agent)
    if not agent_id or not _ensure_identity(agent):
        return None
    url, token, project = _conf()
    args = {
        "project_key": project,
        "agent_name": agent_id,
        "paths": plist,
        "ttl_seconds": int(ttl_seconds),
        "exclusive": bool(exclusive),
        "reason": reason or "",
    }
    try:
        res = _submit(_acall(url, token, "file_reservation_paths", args), _timeout())
        _note_ok()
    except Exception as exc:  # noqa: BLE001
        _note_fail(exc)
        return None
    if not isinstance(res, dict):
        return None
    granted = [
        {
            "path": g.get("path_pattern"),
            "exclusive": g.get("exclusive"),
            "expires": g.get("expires_ts"),
            "reason": g.get("reason"),
            "id": g.get("id"),
        }
        for g in (res.get("granted") or [])
        if isinstance(g, dict)
    ]
    return {"granted": granted, "conflicts": res.get("conflicts") or []}


def release(agent: str, paths: Optional[Iterable[str]] = None) -> Optional[dict[str, Any]]:
    """Release a worker's file leases (a subset by path, or all). Best effort."""
    # Never trigger setup just to release; if the agent never registered (so never
    # held a lease) there is nothing to do.
    if not enabled() or agent not in _registered:
        return None
    agent_id = IDENTITIES.get(agent)
    if not agent_id:
        return None
    url, token, project = _conf()
    args: dict[str, Any] = {"project_key": project, "agent_name": agent_id}
    plist = [p for p in (paths or []) if p]
    if plist:
        args["paths"] = plist
    try:
        res = _submit(_acall(url, token, "release_file_reservations", args), _timeout())
        _note_ok()
        return res if isinstance(res, dict) else None
    except Exception as exc:  # noqa: BLE001
        _note_fail(exc)
        return None


# ---- shutdown ------------------------------------------------------------


async def _aclose() -> None:
    global _client
    if _client is not None:
        try:
            await _client.__aexit__(None, None, None)
        except Exception:  # noqa: BLE001
            pass
        _client = None


@atexit.register
def _shutdown() -> None:  # pragma: no cover - process teardown
    try:
        if _loop is not None:
            import asyncio

            fut = asyncio.run_coroutine_threadsafe(_aclose(), _loop)
            try:
                fut.result(timeout=2)
            except Exception:  # noqa: BLE001
                pass
            _loop.call_soon_threadsafe(_loop.stop)
    except Exception:  # noqa: BLE001
        pass
