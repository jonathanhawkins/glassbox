"""Subprocess wrappers over the `br` CLI (beads_rust), the bead graph.

The tool is ``br`` (NOT ``bd``). The workspace under .beads is already
initialized with prefix ``weavehacks4``. We always pass ``--json`` and parse
stdout so callers get plain Python data, never text.

Verified CLI shapes (br 0.1.34):
    br create "<title>" -t task -p 2 --deps "blocks:id,blocks:id" --json
        -> dict with key "id" (e.g. "weavehacks4-sd0").
    br ready --json   -> bare JSON list of issue objects (open + unblocked).
    br list --json    -> {"issues": [...], "total": N, ...}.
    br update <id> --status in_progress   (fails if the bead is still blocked).
    br close  <id> -r "<reason>".

Dependency semantics: ``--deps "blocks:X"`` on a new bead means the new bead is
BLOCKED BY X (it depends on X). The new bead stays out of ``br ready`` until X
is closed. This is exactly the planner's dependency wiring.

Public interface (other pillars call these):
    create(title, body="", btype="task", priority=2, deps=None) -> str (bead_id)
    ready()                          -> list[dict]
    list_all()                       -> list[dict]
    claim(bead_id, assignee="")      -> dict   (status -> in_progress)
    close(bead_id, reason="")        -> dict   ({"id":..., "closed": True})
    get(bead_id)                     -> dict   (single issue via show --json)
"""
from __future__ import annotations

import json
import subprocess
import threading
import time
from typing import Any, Optional, Sequence

from . import _paths

_paths.ensure_repo_root()

BR = "br"
# The beads DB (one SQLite file) is shared by the server's bead poller and a run,
# and (if a CLI run and the server overlap) across processes, so br calls must not
# fight over it: --lock-timeout makes a writer WAIT for the lock instead of erroring
# or hanging unbounded, the in-process lock stops our own threads from spawning
# concurrent br subprocesses, and we retry briefly on a lock/busy error.
_TIMEOUT = 45             # per-attempt subprocess timeout (> the lock wait below)
_LOCK_TIMEOUT_MS = 15000  # SQLite busy timeout passed to br (wait up to 15s)
_RETRIES = 4
_BR_LOCK = threading.Lock()


class BeadsError(RuntimeError):
    """A `br` invocation failed (nonzero exit) or produced unparseable JSON."""


def _is_contention(text: str) -> bool:
    """Whether a br failure looks like transient DB lock contention (retry-worthy)."""
    t = (text or "").lower()
    return "lock" in t or "busy" in t or "database is locked" in t


def _run(args: Sequence[str], *, parse_json: bool = True) -> Any:
    """Run `br <args>` from the repo root. Return parsed JSON or raw stdout.

    Serializes br within this process and survives a busy beads DB: passes
    --lock-timeout so a writer waits for the SQLite lock, and retries with backoff
    on a timeout or a lock/busy error. Raises BeadsError only after exhausting
    retries (or on a non-contention failure), so callers never silently proceed.
    """
    cmd = [BR, "--lock-timeout", str(_LOCK_TIMEOUT_MS), *args]
    last = ""
    for attempt in range(_RETRIES):
        try:
            # One br subprocess at a time per process: the poller thread and a run
            # thread take turns rather than fighting over the single SQLite DB.
            with _BR_LOCK:
                proc = subprocess.run(
                    cmd,
                    cwd=str(_paths.REPO_ROOT),
                    capture_output=True,
                    text=True,
                    timeout=_TIMEOUT,
                )
        except subprocess.TimeoutExpired:
            last = f"timed out after {_TIMEOUT}s"
            time.sleep(0.3 * (attempt + 1))
            continue
        if proc.returncode == 0:
            out = proc.stdout.strip()
            if not parse_json:
                return out
            if not out:
                return None
            try:
                return json.loads(out)
            except json.JSONDecodeError as exc:
                raise BeadsError(
                    f"br {' '.join(args)} returned non-JSON output: {out[:200]!r}"
                ) from exc
        last = proc.stderr.strip() or proc.stdout.strip()
        if _is_contention(last) and attempt < _RETRIES - 1:
            time.sleep(0.3 * (attempt + 1))
            continue
        raise BeadsError(
            f"br {' '.join(args)} failed (exit {proc.returncode}): {last}"
        )
    raise BeadsError(f"br {' '.join(args)} failed after {_RETRIES} attempts: {last}")


def checkpoint_wal() -> None:
    """Best-effort: fold the SQLite WAL back into the beads DB so it cannot bloat.

    A long run does hundreds of bead writes; if the WAL is never checkpointed it can
    grow to hundreds of MB and make every subsequent write crawl (the failure mode
    that hung a run). Call this at the start of a climb so a fresh, trim WAL is
    inherited; normal autocheckpoint keeps it bounded during the run. Never raises.
    """
    import glob
    import sqlite3

    try:
        dbs = glob.glob(str(_paths.REPO_ROOT / ".beads" / "*.db"))
    except Exception:  # noqa: BLE001
        return
    for db in dbs:
        try:
            with _BR_LOCK:
                conn = sqlite3.connect(db, timeout=5)
                try:
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                finally:
                    conn.close()
        except Exception:  # noqa: BLE001 - best effort, never block a run
            pass


def _deps_arg(deps: Optional[Sequence[str]]) -> Optional[str]:
    """Normalize deps into the `type:id` comma list `br --deps` expects.

    Accepts bare ids ("weavehacks4-ab1") or already-typed entries
    ("blocks:weavehacks4-ab1"). Bare ids default to the ``blocks`` type, which
    means the new bead is blocked by (depends on) that id.
    """
    if not deps:
        return None
    parts: list[str] = []
    for d in deps:
        d = str(d).strip()
        if not d:
            continue
        parts.append(d if ":" in d else f"blocks:{d}")
    return ",".join(parts) if parts else None


def create(
    title: str,
    body: str = "",
    btype: str = "task",
    priority: int = 2,
    deps: Optional[Sequence[str]] = None,
) -> str:
    """Create a bead and return its id.

    deps are ids this bead depends on (it stays blocked until they close).
    Pass bare ids or "blocks:id" entries.
    """
    args: list[str] = [
        "create",
        title,
        "-t",
        btype,
        "-p",
        str(priority),
    ]
    if body:
        args += ["-d", body]
    deps_arg = _deps_arg(deps)
    if deps_arg:
        args += ["--deps", deps_arg]
    args.append("--json")
    data = _run(args)
    if not isinstance(data, dict) or "id" not in data:
        raise BeadsError(f"br create returned unexpected payload: {data!r}")
    return str(data["id"])


def ready() -> list[dict[str, Any]]:
    """Return ready issues (open, unblocked, not deferred) as a list of dicts."""
    data = _run(["ready", "--json"])
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("issues", data.get("ready", []))  # tolerate either shape
    return []


def list_all() -> list[dict[str, Any]]:
    """Return all issues as a flat list of dicts.

    `br list --json` wraps results in {"issues": [...]}; we unwrap it.
    """
    data = _run(["list", "--json"])
    if isinstance(data, dict):
        return data.get("issues", [])
    if isinstance(data, list):
        return data
    return []


def claim(bead_id: str, assignee: str = "") -> dict[str, Any]:
    """Mark a bead in_progress (and optionally assign it).

    Raises BeadsError if the bead is still blocked (br refuses to claim a
    blocked issue). Coordinator should only claim ids returned by ready().
    """
    args = ["update", bead_id, "--status", "in_progress"]
    if assignee:
        args += ["--assignee", assignee]
    _run(args, parse_json=False)
    return {"id": bead_id, "status": "in_progress", "assignee": assignee or None}


def close(bead_id: str, reason: str = "") -> dict[str, Any]:
    """Close a bead, optionally with a reason. Returns a small status dict."""
    args = ["close", bead_id]
    if reason:
        args += ["-r", reason]
    _run(args, parse_json=False)
    return {"id": bead_id, "closed": True, "reason": reason or None}


def close_open(reason: str = "") -> int:
    """Close every not-yet-closed bead. Returns the count closed.

    Used to clear the graph between runs (and between improve_loop versions) so a
    drain works only its own freshly-planned beads, never stragglers from a prior
    or interrupted run. Closes blocked beads too (which ``ready()`` would miss),
    and is best effort: a single failed close never aborts the sweep.
    """
    closed = 0
    for issue in list_all():
        bid = issue.get("id")
        status = str(issue.get("status", "")).strip().lower()
        if bid and status != "closed":
            try:
                close(bid, reason=reason or "cleared")
                closed += 1
            except BeadsError:
                pass
    return closed


def get(bead_id: str) -> dict[str, Any]:
    """Return a single issue's details via `br show <id> --json`.

    `br show` returns a single-element JSON list; we unwrap it. We also tolerate
    a dict (possibly wrapped under "issue") in case the CLI shape changes.
    """
    data = _run(["show", bead_id, "--json"])
    if isinstance(data, list):
        if not data:
            raise BeadsError(f"br show {bead_id} returned an empty list")
        first = data[0]
        if isinstance(first, dict):
            return first
    if isinstance(data, dict):
        return data.get("issue", data)
    raise BeadsError(f"br show {bead_id} returned unexpected payload: {data!r}")
