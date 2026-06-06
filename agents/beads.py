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
from typing import Any, Optional, Sequence

from . import _paths

_paths.ensure_repo_root()

BR = "br"
_TIMEOUT = 60  # seconds; br is local SQLite, fast.


class BeadsError(RuntimeError):
    """A `br` invocation failed (nonzero exit) or produced unparseable JSON."""


def _run(args: Sequence[str], *, parse_json: bool = True) -> Any:
    """Run `br <args>` from the repo root. Return parsed JSON or raw stdout.

    Raises BeadsError on nonzero exit so callers never silently proceed on a
    failed bead operation.
    """
    cmd = [BR, *args]
    proc = subprocess.run(
        cmd,
        cwd=str(_paths.REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=_TIMEOUT,
    )
    if proc.returncode != 0:
        raise BeadsError(
            f"br {' '.join(args)} failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
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
