"""FastAPI server for the Glassbox cockpit (port 8100).

Exposes the swarm to the Next.js cockpit (port 3100):

    GET  /health      -> {"ok": true}
    GET  /leaderboard -> [{"version", "accuracy"}, ...] (from the Redis ZSET)
    GET  /beads       -> current beads (the poller mirror glassbox:beads if
                         present, else a live beads.ready() fallback)
    POST /run   {goal}      -> start one run_cycle in a background thread,
                               returns {"run_id"} immediately
    POST /loop  {goal,...}  -> start the GENUINE improve_loop (resets the skill
                               from baseline and rewrites it each cycle) in a
                               background thread, returns {"run_base"} immediately
    POST /live  {goal}      -> start run_cycle_live (plan-gap-found + bead_injected
                               beat) in a background thread, returns {"run_id"}
    GET  /skill             -> {"current": SKILL.md text, "covered": [...],
                               "versions": [{version, path, covered}]} read from
                               agents/planner/history/

A background poller thread mirrors the bead graph (ready + all) to the Redis key
``glassbox:beads`` every ~1.5s so the cockpit can read bead state without each
client shelling ``br``. The leaderboard and the event stream are written by the
swarm itself (agents/bus.py); this server only reads them.

Run it:
    uvicorn agents.server:app --host 0.0.0.0 --port 8100
    (or: bash scripts/backend.sh)
"""
from __future__ import annotations

import json
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from contract.events import BEADS_STATE, SKILL_STATE  # noqa: E402

from . import beads, bus, skill  # noqa: E402

# Allowed cockpit origins (frontend dev server on 3100, never 3000).
ALLOWED_ORIGINS = [
    "http://localhost:3100",
    "http://127.0.0.1:3100",
]

POLL_INTERVAL_S = 1.5

# This server IS the demo backend for the cockpit, so runs should be watchable
# by default: a worker holds each wave of beads in flight for this many ms so the
# board can show the chips route into the worker docks and the workers light up
# in parallel. An operator running the headless overnight loop can still export
# GLASSBOX_PACE_MS=0 to run flat out (setdefault never overrides an explicit set).
DEFAULT_PACE_MS = "1200"

# Coordinates for the background poller so startup/shutdown can manage it.
_poll_stop = threading.Event()
_poll_thread: Optional[threading.Thread] = None


def _snapshot_beads() -> dict[str, Any]:
    """Build the bead mirror: ready ids plus the full list, with a timestamp."""
    try:
        ready = beads.ready()
    except Exception as exc:  # noqa: BLE001 - mirror is best effort
        ready = []
        print(f"[poller] beads.ready() failed: {exc}")
    try:
        all_beads = beads.list_all()
    except Exception as exc:  # noqa: BLE001
        all_beads = []
        print(f"[poller] beads.list_all() failed: {exc}")
    ready_ids = {b.get("id") for b in ready if b.get("id")}
    in_progress = [b for b in all_beads if b.get("status") == "in_progress"]
    return {
        "ts": int(time.time() * 1000),
        "ready": ready,
        "in_progress": in_progress,
        "all": all_beads,
        "ready_ids": sorted(i for i in ready_ids if i),
    }


def _snapshot_skill() -> dict[str, Any]:
    """Build the skill mirror: the current SKILL.md plus every version snapshot.

    versions = [{version, covered, text}] read from agents/planner/history/, so
    the cockpit can render and step through how the planner skill grew v1 -> vN.
    Best effort: any read failure degrades to an empty field, never raises.
    """
    from pathlib import Path

    try:
        current = skill.read_skill()
    except OSError as exc:  # noqa: BLE001 - mirror is best effort
        current = ""
        print(f"[poller] skill.read_skill() failed: {exc}")
    try:
        covered = skill.covered_categories()
    except ValueError:
        covered = []
    versions: list[dict[str, Any]] = []
    try:
        for entry in skill.history():
            try:
                text = skill.read_skill(Path(entry["path"]))
            except OSError:
                text = ""
            versions.append(
                {
                    "version": entry["version"],
                    "covered": entry["covered"],
                    "text": text,
                }
            )
    except Exception as exc:  # noqa: BLE001 - mirror is best effort
        print(f"[poller] skill.history() failed: {exc}")
    return {
        "ts": int(time.time() * 1000),
        "current": current,
        "covered": covered,
        "versions": versions,
    }


def _poll_loop() -> None:
    """Mirror the bead graph + planner skill to Redis every POLL_INTERVAL_S."""
    client = bus.get_client()
    while not _poll_stop.is_set():
        try:
            client.set(BEADS_STATE, json.dumps(_snapshot_beads()))
            client.set(SKILL_STATE, json.dumps(_snapshot_skill()))
        except Exception as exc:  # noqa: BLE001 - never let the poller die loudly
            print(f"[poller] write skipped: {exc}")
        _poll_stop.wait(POLL_INTERVAL_S)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Start the bead poller on startup, stop it cleanly on shutdown."""
    global _poll_thread
    # Make cockpit-driven runs watchable unless the operator pinned a pace.
    os.environ.setdefault("GLASSBOX_PACE_MS", DEFAULT_PACE_MS)
    _poll_stop.clear()
    _poll_thread = threading.Thread(target=_poll_loop, name="bead-poller", daemon=True)
    _poll_thread.start()
    try:
        yield
    finally:
        _poll_stop.set()
        if _poll_thread is not None:
            _poll_thread.join(timeout=3.0)


app = FastAPI(title="Glassbox swarm", version="1.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    goal: str = "port the BPE tokenizer to Rust"
    planner_version: int = 1
    task: str = "tokenizer"


class LoopRequest(BaseModel):
    goal: str = "port the BPE tokenizer to Rust"
    # max_versions caps the genuine improve_loop; defaults to the 7 categories
    # plus one (so v1 baseline can climb to full coverage with headroom).
    max_versions: int = 8
    # Accepted for backward compatibility with the old climb_loop request shape.
    versions: Optional[int] = None
    task: str = "tokenizer"


class LiveRequest(BaseModel):
    goal: str = "port the BPE tokenizer to Rust"
    injections: int = 2
    task: str = "tokenizer"


class ResetRequest(BaseModel):
    # Reset the planner skill back to the intentionally-incomplete baseline (ascii
    # only) and clear the v2..vN history, so Reset is a genuine start-over.
    reset_skill: bool = True
    task: str = "tokenizer"


# Only one swarm op may run at a time: the workspace source (e.g.
# tokenizer-rs/src/pretok.rs) and the build target are SHARED, so overlapping runs
# would race on the source file and grade each other's binary. The lock is held for
# the whole duration of a run; overlapping requests are rejected with 409.
_RUN_LOCK = threading.Lock()


def _start_thread(target, *args, name: str) -> None:
    """Run a blocking swarm op in a daemon thread so the HTTP call returns now.

    Single-run guard: if a run is already in progress, raise 409 rather than start a
    second one against the shared workspace. The lock releases when the op finishes.
    """
    if not _RUN_LOCK.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="a swarm run is already in progress; wait for it to finish",
        )

    def _guarded() -> None:
        try:
            target(*args)
        finally:
            _RUN_LOCK.release()

    threading.Thread(target=_guarded, name=name, daemon=True).start()


def _restore_quietly(task) -> None:
    """Restore the workspace to its green state after a run (best effort, no raise).

    A run leaves the workspace source partial; this re-renders the complete source
    so the repo is green at rest. Genuine results persist in the leaderboard and the
    history snapshots, so this loses nothing.
    """
    try:
        task.restore_workspace()
    except Exception as exc:  # noqa: BLE001
        print(f"[run] restore_workspace failed: {exc}")


def _run_cycle_bg(task_name: str, goal: str, run_id: str, planner_version: int) -> None:
    # Imported lazily so importing the server never triggers weave.init.
    from . import run as run_module
    from tasks import load_task

    task = load_task(task_name)
    try:
        run_module.run_cycle(task, goal, run_id, planner_version=planner_version)
    except Exception as exc:  # noqa: BLE001 - surface in logs, do not crash server
        print(f"[run] run_cycle({run_id}) failed: {exc}")
    finally:
        _restore_quietly(task)


def _improve_loop_bg(task_name: str, goal: str, run_base: str, max_versions: int) -> None:
    from . import run as run_module
    from tasks import load_task

    task = load_task(task_name)
    try:
        run_module.improve_loop(task, goal, run_base, max_versions=max_versions)
    except Exception as exc:  # noqa: BLE001
        print(f"[run] improve_loop({run_base}) failed: {exc}")
    finally:
        _restore_quietly(task)


def _live_bg(task_name: str, goal: str, run_id: str, injections: int) -> None:
    from . import run as run_module
    from tasks import load_task

    task = load_task(task_name)
    try:
        run_module.run_cycle_live(task, goal, run_id, injections=injections)
    except Exception as exc:  # noqa: BLE001
        print(f"[run] run_cycle_live({run_id}) failed: {exc}")
    finally:
        _restore_quietly(task)


@app.get("/health")
def health() -> dict[str, bool]:
    """Liveness probe for the cockpit."""
    return {"ok": True}


@app.get("/leaderboard")
def leaderboard() -> list[dict[str, Any]]:
    """Return the planner-version leaderboard, ascending by accuracy."""
    return [
        {"version": version, "accuracy": accuracy}
        for version, accuracy in bus.get_leaderboard()
    ]


@app.get("/beads")
def get_beads() -> dict[str, Any]:
    """Return the bead mirror (glassbox:beads) or a live fallback if absent."""
    raw = bus.get_client().get(BEADS_STATE)
    if raw:
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            pass
    # Fallback: compute a snapshot on demand if the poller has not written yet.
    return _snapshot_beads()


@app.post("/run")
def post_run(req: RunRequest) -> dict[str, str]:
    """Start one run_cycle in the background; return its run_id immediately."""
    run_id = f"run-{int(time.time() * 1000)}"
    _start_thread(
        _run_cycle_bg,
        req.task,
        req.goal,
        run_id,
        req.planner_version,
        name=f"run-{run_id}",
    )
    return {"run_id": run_id}


@app.post("/loop")
def post_loop(req: LoopRequest) -> dict[str, Any]:
    """Start the genuine improve_loop in the background; return its run_base now.

    improve_loop resets SKILL.md from the incomplete baseline and rewrites it to
    cover one more failing category per cycle, so the leaderboard climbs as a real
    consequence of the skill evolving. The legacy ``versions`` field, if sent, is
    honored as ``max_versions`` for backward compatibility.
    """
    max_versions = req.versions if req.versions is not None else req.max_versions
    run_base = f"loop-{int(time.time() * 1000)}"
    _start_thread(
        _improve_loop_bg,
        req.task,
        req.goal,
        run_base,
        max_versions,
        name=f"loop-{run_base}",
    )
    return {"run_base": run_base, "max_versions": max_versions}


@app.post("/live")
def post_live(req: LiveRequest) -> dict[str, Any]:
    """Start the live inject-the-gap beat in the background; return its run_id."""
    run_id = f"live-{int(time.time() * 1000)}"
    _start_thread(
        _live_bg, req.task, req.goal, run_id, req.injections, name=f"live-{run_id}"
    )
    return {"run_id": run_id, "injections": req.injections}


@app.get("/skill")
def get_skill() -> dict[str, Any]:
    """Return the planner skill mirror: current text, coverage, per-version text.

    Same shape as the Redis ``glassbox:skill`` cache the poller writes:
    {ts, current, covered, versions: [{version, covered, text}]} read from
    agents/planner/history/ so the cockpit can read and step through v1 -> vN.
    """
    return _snapshot_skill()


@app.post("/reset")
def post_reset(req: ResetRequest = ResetRequest()) -> dict[str, Any]:
    """Clear the live demo state for a clean restart.

    Clears the Redis event stream, leaderboard, bead mirror, and per-run caps;
    closes any ready beads (so the poller does not refill the board with
    stragglers); and, by default, restores SKILL.md to full coverage so a cold
    'Launch run' shows the finished tokenizer while 'Run climb' rebuilds it.
    """
    state = bus.reset_state()
    closed = 0
    try:
        for b in beads.ready():
            bid = b.get("id")
            if bid:
                beads.close(bid, reason="reset")
                closed += 1
    except Exception as exc:  # noqa: BLE001 - reset is best effort
        print(f"[reset] bead close skipped: {exc}")
    skill_state = "unchanged"
    if req.reset_skill:
        try:
            # Genuine planner-skill reset: revert SKILL.md to the incomplete
            # baseline (ascii only) and drop the stale v2..vN snapshots, then
            # snapshot the baseline as v1, so the strip and the skill viewer
            # start over at v1 instead of showing the previous climb.
            skill.reset_to_baseline()
            skill.reset_history()
            skill.snapshot(1)
            skill_state = "baseline"
        except Exception as exc:  # noqa: BLE001
            print(f"[reset] skill reset skipped: {exc}")
    # Restore the task workspace to its complete green state, in symmetry with the
    # skill reset: a cold 'Launch run' then shows the finished artifact and the repo
    # is green. (A 'Run climb' resets the workspace to baseline itself at the start.)
    try:
        from tasks import load_task

        load_task(req.task).restore_workspace()
    except Exception as exc:  # noqa: BLE001
        print(f"[reset] workspace restore skipped: {exc}")
    # Re-mirror the (now empty) bead graph and the reset skill immediately so the
    # board and the skill viewer reflect the reset without waiting for a poll tick.
    try:
        client = bus.get_client()
        client.set(BEADS_STATE, json.dumps(_snapshot_beads()))
        client.set(SKILL_STATE, json.dumps(_snapshot_skill()))
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "redis": state, "beads_closed": closed, "skill": skill_state}
