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

from contract.events import BEADS_STATE  # noqa: E402

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


def _snapshot_skill(cfg: Any = None) -> dict[str, Any]:
    """Build a task's skill mirror: current text, covered groups, the group order +
    unit (for the cockpit tiles), and every version snapshot.

    versions = [{version, covered, text}] read from the task's history dir, so the
    cockpit can render and step through how the planner skill grew v1 -> vN. Best
    effort: any read failure degrades to an empty field, never raises. ``cfg``
    defaults to the tokenizer skill.
    """
    from pathlib import Path

    if cfg is None:
        cfg = skill.TOKENIZER
    try:
        current = skill.read_skill(cfg.skill_path)
    except OSError as exc:  # noqa: BLE001 - mirror is best effort
        current = ""
        print(f"[poller] skill.read_skill() failed: {exc}")
    try:
        covered = skill.covered_categories(cfg)
    except ValueError:
        covered = []
    versions: list[dict[str, Any]] = []
    try:
        for entry in skill.history(cfg):
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
        "order": list(cfg.order),
        "unit": cfg.unit,
        "versions": versions,
    }


def _snapshot_workspace(task: Any) -> dict[str, Any]:
    """Build a task's workspace-code mirror: the live source files plus every
    per-version snapshot (history/v{n}/), so the cockpit can step v1..vN and watch
    the real code the swarm wrote grow.

    ``current`` maps each edit_target (rel path) to the live file (the finished,
    restored source at rest). ``versions[].files`` maps the same rel paths to the
    source at that version. Per-version ``covered`` (from the skill history) and
    ``accuracy`` (from the leaderboard) are correlated by version number for labels.
    Best effort: every read degrades to empty, never raises.
    """
    from pathlib import Path

    targets = list(getattr(task, "edit_targets", []) or [])
    cfg = getattr(task, "skill", None) or skill.TOKENIZER
    current = {rel: task.read_target(rel) for rel in targets}

    covered_by_v: dict[int, list[str]] = {}
    try:
        for entry in skill.history(cfg):
            covered_by_v[int(entry["version"])] = entry.get("covered", [])
    except Exception as exc:  # noqa: BLE001 - labels are best effort
        print(f"[workspace] skill.history failed: {exc}")
    acc_by_v: dict[int, float] = {}
    try:
        for version, accuracy in bus.get_leaderboard(getattr(task, "name", "tokenizer")):
            acc_by_v[int(version)] = float(accuracy)
    except Exception as exc:  # noqa: BLE001
        print(f"[workspace] leaderboard failed: {exc}")

    versions: list[dict[str, Any]] = []
    hist = getattr(task, "history_dir", None)
    if hist and Path(hist).is_dir():
        vdirs: list[tuple[int, Path]] = []
        for child in Path(hist).iterdir():
            if child.is_dir() and child.name.startswith("v") and child.name[1:].isdigit():
                vdirs.append((int(child.name[1:]), child))
        for n, vdir in sorted(vdirs):
            files: dict[str, str] = {}
            for rel in targets:
                p = vdir / rel
                if p.exists():
                    try:
                        files[rel] = p.read_text(encoding="utf-8")
                    except OSError:
                        files[rel] = ""
            entry: dict[str, Any] = {"version": n, "files": files}
            if n in covered_by_v:
                entry["covered"] = covered_by_v[n]
            if n in acc_by_v:
                entry["accuracy"] = acc_by_v[n]
            versions.append(entry)

    return {
        "ts": int(time.time() * 1000),
        "task": getattr(task, "name", ""),
        "edit_targets": targets,
        "unit": cfg.unit,
        "current": current,
        "versions": versions,
    }


def _poll_loop() -> None:
    """Mirror the bead graph to Redis every POLL_INTERVAL_S.

    The planner skill is no longer mirrored here: the cockpit reads it per task on
    demand via GET /skill?task=, so a single tokenizer-only mirror would be wrong
    for the textkit and has no reader.
    """
    client = bus.get_client()
    while not _poll_stop.is_set():
        try:
            client.set(BEADS_STATE, json.dumps(_snapshot_beads()))
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


class BYORequest(BaseModel):
    # Bring-your-own-repo: point the swarm at a real repo and make its failing tests
    # pass. Only pytest is supported for the demo.
    repo: str
    goal: str = "Make the failing tests pass."
    test: str = "pytest"
    test_args: Optional[list[str]] = None
    edit: Optional[list[str]] = None  # editable globs (default ["**/*.py"])
    tests: Optional[list[str]] = None  # read-only test dirs (default ["tests","test"])
    label: Optional[str] = None
    max_rounds: int = 4


# Cache of built BYO tasks (keyed by their generated id) and their cockpit metadata.
# A BYO task is expensive to build (clone + discover groups), so it is built once in
# the background and reused by every /skill, /workspace, /leaderboard, /loop request.
_BYO_TASKS: dict[str, Any] = {}
_BYO_META: dict[str, dict[str, Any]] = {}


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

    # Clear any stale stop request so it can never abort the run we are about to
    # start (the Stop button sets this flag; run.py checks it at each boundary).
    from . import run as run_module

    run_module.clear_cancel()

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


def _resolve_task(name: str):
    """Resolve a task name to a built Task: a cached BYO task first, else load_task.

    BYO tasks are not in the static registry (they are created at runtime from a
    repo), so they live in _BYO_TASKS keyed by their generated id.
    """
    from tasks import load_task

    if name in _BYO_TASKS:
        return _BYO_TASKS[name]
    return load_task(name)


def _run_cycle_bg(task_name: str, goal: str, run_id: str, planner_version: int) -> None:
    # Imported lazily so importing the server never triggers weave.init.
    from . import run as run_module

    task = _resolve_task(task_name)
    try:
        run_module.run_cycle(task, goal, run_id, planner_version=planner_version)
    except Exception as exc:  # noqa: BLE001 - surface in logs, do not crash server
        print(f"[run] run_cycle({run_id}) failed: {exc}")
    finally:
        _restore_quietly(task)


def _improve_loop_bg(task_name: str, goal: str, run_base: str, max_versions: int) -> None:
    from . import run as run_module

    task = _resolve_task(task_name)
    try:
        run_module.improve_loop(task, goal, run_base, max_versions=max_versions)
    except Exception as exc:  # noqa: BLE001
        print(f"[run] improve_loop({run_base}) failed: {exc}")
    finally:
        _restore_quietly(task)


def _byo_loop_bg(task_name: str, goal: str, run_base: str, max_rounds: int) -> None:
    from . import run as run_module

    task = _resolve_task(task_name)
    try:
        run_module.byo_loop(task, goal, run_base, max_rounds=max_rounds)
    except Exception as exc:  # noqa: BLE001
        print(f"[run] byo_loop({run_base}) failed: {exc}")
    finally:
        _restore_quietly(task)


def _optimize_loop_bg(task_name: str, goal: str, run_base: str, max_rounds: int) -> None:
    from . import run as run_module

    task = _resolve_task(task_name)
    try:
        run_module.optimize_loop(task, goal, run_base, max_rounds=max_rounds)
    except Exception as exc:  # noqa: BLE001
        print(f"[run] optimize_loop({run_base}) failed: {exc}")
    finally:
        _restore_quietly(task)


def _live_bg(task_name: str, goal: str, run_id: str, injections: int) -> None:
    from . import run as run_module

    task = _resolve_task(task_name)
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


@app.get("/status")
def status() -> dict[str, bool]:
    """Run state for the cockpit transport panel.

    ``running`` is whether the run lock is held (true for the whole run/loop, even
    between versions); ``paused`` is whether the run is parked at a boundary
    waiting to resume. The cockpit polls this to light the Play/Pause/Stop pills.
    """
    from . import run as run_module

    return {"running": _RUN_LOCK.locked(), "paused": run_module.is_paused()}


@app.post("/stop")
def post_stop() -> dict[str, bool]:
    """Ask the in-flight run to stop at the next wave/version boundary.

    Cooperative cancellation: run.py checks the flag between waves and versions
    and bails cleanly (never mid-bead), then the run lock releases. Returns
    whether a run was actually in progress to stop.
    """
    from . import run as run_module

    was_running = _RUN_LOCK.locked()
    run_module.request_cancel()
    return {"stopped": was_running}


@app.post("/pause")
def post_pause() -> dict[str, bool]:
    """Hold the in-flight run at the next wave/version boundary (resume with /resume).

    Cooperative, like /stop: the run parks cleanly between waves (never mid-bead)
    and keeps the run lock, so it picks up in place on resume.
    """
    from . import run as run_module

    was_running = _RUN_LOCK.locked()
    if was_running:
        run_module.request_pause()
    return {"paused": was_running}


@app.post("/resume")
def post_resume() -> dict[str, bool]:
    """Release a paused run so it continues from where it parked."""
    from . import run as run_module

    was_paused = run_module.is_paused()
    run_module.resume()
    return {"resumed": was_paused}


def _require_task(name: str):
    """Load a task by name or raise 404, so an unknown ?task= never 500s.

    A cached BYO task wins over the static registry. A BYO id that exists in the
    metadata but is still discovering (not built yet) raises 409 so callers know to
    wait rather than 404 (which reads as 'unknown').
    """
    from tasks import available_tasks, load_task

    if name in _BYO_TASKS:
        return _BYO_TASKS[name]
    if name in _BYO_META:
        raise HTTPException(
            status_code=409, detail=f"task {name!r} is still discovering its groups"
        )
    try:
        return load_task(name)
    except (ValueError, KeyError):
        raise HTTPException(
            status_code=404,
            detail=f"unknown task {name!r} (have: {sorted(available_tasks())})",
        )


@app.get("/tasks")
def get_tasks() -> list[dict[str, Any]]:
    """List available tasks: the static curated tasks plus any runtime BYO tasks."""
    from tasks import task_specs

    return task_specs() + list(_BYO_META.values())


def _byo_build_bg(task_id: str, cfg: dict[str, Any]) -> None:
    """Build a BYO task (clone + discover groups) and cache it; flip discovering off.

    Runs off the request thread because cloning and the first eval are slow. On
    failure the task is marked errored so the cockpit can surface it.
    """
    from tasks.byo import build_task

    try:
        task = build_task(cfg)
        _BYO_TASKS[task_id] = task
        meta = _BYO_META.get(task_id, {})
        meta.update(
            {
                "discovering": False,
                "unit": (task.skill.unit if task.skill else "test"),
                "groups": list(task.groups),
            }
        )
        _BYO_META[task_id] = meta
        print(f"[byo] built {task_id}: {len(task.groups)} failing group(s)")
    except Exception as exc:  # noqa: BLE001
        meta = _BYO_META.get(task_id, {})
        meta.update({"discovering": False, "error": str(exc)[:300]})
        _BYO_META[task_id] = meta
        print(f"[byo] build {task_id} failed: {exc}")


@app.post("/tasks/byo")
def post_byo(req: BYORequest) -> dict[str, Any]:
    """Create a bring-your-own-repo task: clone the repo + discover its failing test
    groups in the background; return the task metadata immediately (discovering)."""
    if (req.test or "pytest").strip().lower() != "pytest":
        raise HTTPException(
            status_code=400, detail="only the pytest test command is supported"
        )
    task_id = f"byo-{int(time.time() * 1000)}"
    label = req.label or req.repo.rstrip("/").split("/")[-1] or task_id
    meta = {
        "id": task_id,
        "label": label,
        "goal": req.goal,
        "kind": "byo",
        "unit": "test",
        "discovering": True,
        "repo": req.repo,
        "test_command": req.test,
        "editable": ",".join(req.edit) if req.edit else "**/*.py",
    }
    _BYO_META[task_id] = meta
    cfg = {
        "id": task_id,
        "repo": req.repo,
        "goal": req.goal,
        "test_args": req.test_args,
        "edit": req.edit,
        "tests": req.tests,
        "label": label,
    }
    threading.Thread(
        target=_byo_build_bg, args=(task_id, cfg), name=f"byo-build-{task_id}", daemon=True
    ).start()
    return {"ok": True, "task": meta}


@app.get("/tasks/{task_id}")
def get_task_detail(task_id: str) -> dict[str, Any]:
    """Load one task and return its groups/unit/edit_targets for the cockpit."""
    import agents.skill as skill

    t = _require_task(task_id)
    cfg = t.skill or skill.TOKENIZER
    return {
        "id": t.name,
        "goal": t.goal,
        "kind": getattr(t, "kind", "curated"),
        "groups": list(t.groups),
        "unit": cfg.unit,
        "edit_targets": list(t.edit_targets),
    }


@app.get("/leaderboard")
def leaderboard(task: str = "tokenizer") -> list[dict[str, Any]]:
    """Return the task's planner-version leaderboard, ascending by accuracy."""
    return [
        {"version": version, "accuracy": accuracy}
        for version, accuracy in bus.get_leaderboard(task)
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
    _require_task(req.task)
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
    task_obj = _require_task(req.task)
    max_versions = req.versions if req.versions is not None else req.max_versions
    run_base = f"loop-{int(time.time() * 1000)}"
    # BYO tasks have no skill to rewrite: run the honest re-attempt loop instead, so
    # the curve is the live test pass-rate climbing as beads close (no fallback).
    if getattr(task_obj, "kind", "curated") == "byo":
        _start_thread(
            _byo_loop_bg,
            req.task,
            req.goal,
            run_base,
            max_versions,
            name=f"byo-{run_base}",
        )
        return {"run_base": run_base, "max_rounds": max_versions, "mode": "byo"}
    _start_thread(
        _improve_loop_bg,
        req.task,
        req.goal,
        run_base,
        max_versions,
        name=f"loop-{run_base}",
    )
    return {"run_base": run_base, "max_versions": max_versions}


@app.post("/optimize")
def post_optimize(req: LoopRequest) -> dict[str, Any]:
    """Start the open-ended optimize loop in the background; return its run_base now.

    The loop proposes a new optimization idea each round, keeps only the ones the real
    grader confirms are correct AND strictly better, and stops when it is genuinely
    stuck (a run of rounds with no gain). ``max_versions`` (or legacy ``versions``) caps
    the rounds. Best for byo speed tasks (speedkit, algotune) with a continuous metric.
    """
    _require_task(req.task)
    max_rounds = req.versions if req.versions is not None else req.max_versions
    run_base = f"opt-{int(time.time() * 1000)}"
    _start_thread(
        _optimize_loop_bg,
        req.task,
        req.goal,
        run_base,
        max_rounds,
        name=f"opt-{run_base}",
    )
    return {"run_base": run_base, "max_rounds": max_rounds, "mode": "optimize"}


@app.post("/live")
def post_live(req: LiveRequest) -> dict[str, Any]:
    """Start the live inject-the-gap beat in the background; return its run_id."""
    _require_task(req.task)
    run_id = f"live-{int(time.time() * 1000)}"
    _start_thread(
        _live_bg, req.task, req.goal, run_id, req.injections, name=f"live-{run_id}"
    )
    return {"run_id": run_id, "injections": req.injections}


@app.get("/skill")
def get_skill(task: str = "tokenizer") -> dict[str, Any]:
    """Return the task's planner skill mirror: current text, coverage, group order +
    unit, and per-version text, read on demand so it reflects the requested task.

    Shape: {ts, current, covered, order, unit, versions: [{version, covered, text}]}.
    """
    cfg = _require_task(task).skill or skill.TOKENIZER
    return _snapshot_skill(cfg)


@app.get("/workspace")
def get_workspace(task: str = "tokenizer") -> dict[str, Any]:
    """Return the task's workspace source: the live files plus every per-version
    snapshot, so the cockpit can show the real code the swarm wrote and step v1..vN.

    Shape: {ts, task, edit_targets, unit, current: {rel: text},
    versions: [{version, files: {rel: text}, covered, accuracy}]}.
    """
    return _snapshot_workspace(_require_task(task))


@app.post("/reset")
def post_reset(req: ResetRequest = ResetRequest()) -> dict[str, Any]:
    """Clear the live demo state for a clean restart.

    Clears the Redis event stream, leaderboard, bead mirror, and per-run caps;
    closes EVERY open bead, blocked stragglers included (so the poller does not
    refill the board with leftovers from a prior or interrupted run); and, by
    default, restores SKILL.md to full coverage so a cold 'Launch run' shows the
    finished tokenizer while 'Run climb' rebuilds it.
    """
    task_obj = _require_task(req.task)
    state = bus.reset_state()
    # Close every not-yet-closed bead, not just the ready ones: ready() misses
    # blocked stragglers, which the poller would then refill the board with.
    # close_open() sweeps the whole graph and is best effort per bead.
    try:
        closed = beads.close_open(reason="reset")
    except Exception as exc:  # noqa: BLE001 - reset is best effort
        closed = 0
        print(f"[reset] bead close skipped: {exc}")
    skill_state = "unchanged"
    if req.reset_skill:
        try:
            # Genuine planner-skill reset: revert the task's skill to the incomplete
            # baseline and drop the stale v2..vN snapshots, then snapshot the
            # baseline as v1, so the strip and the skill viewer start over at v1
            # instead of showing the previous climb.
            _skill_cfg = task_obj.skill or skill.TOKENIZER
            skill.reset_to_baseline(_skill_cfg)
            skill.reset_history(_skill_cfg)
            skill.snapshot(1, cfg=_skill_cfg)
            skill_state = "baseline"
        except Exception as exc:  # noqa: BLE001
            print(f"[reset] skill reset skipped: {exc}")
    # Restore the task workspace to its complete green state, in symmetry with the
    # skill reset: a cold 'Launch run' then shows the finished artifact and the repo
    # is green. (A 'Run climb' resets the workspace to baseline itself at the start.)
    try:
        task_obj.restore_workspace()
    except Exception as exc:  # noqa: BLE001
        print(f"[reset] workspace restore skipped: {exc}")
    # Drop the per-version code snapshots too, the analog of skill.reset_history: the
    # workspace code viewer reads history/v{n}/, so without this the code panel keeps
    # showing the previous climb's v1..vN after a reset. Clear it so the panel starts
    # over (current code only, "run a climb to watch it grow") like a fresh board.
    try:
        task_obj.reset_workspace_history()
    except Exception as exc:  # noqa: BLE001
        print(f"[reset] workspace history clear skipped: {exc}")
    # Re-mirror the (now empty) bead graph immediately so the board reflects the
    # reset without waiting for a poll tick. (The skill is read per task on demand.)
    try:
        bus.get_client().set(BEADS_STATE, json.dumps(_snapshot_beads()))
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "redis": state, "beads_closed": closed, "skill": skill_state}
