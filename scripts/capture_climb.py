"""Capture a real self-improving climb as a committable evidence artifact.

Runs the genuine ``agents.run.improve_loop`` for one or more tasks and writes
``docs/runs/<task>-climb.json``: the per-version accuracy (measured by the real
oracle / pytest on the rebuilt artifact), the Redis leaderboard, and the
per-version metadata (which category the improver added, the eval wall time).

It runs with ``GLASSBOX_WORKER_LLM=0`` on purpose: the deterministic curriculum
path is fully reproducible by anyone with no API key, and the SCORES are real
evaluator measurements either way (a kept LLM edit must still beat the oracle).
So this artifact backs exactly the honest claim: "accuracy climbs across
versions, oracle-graded," not "a model emergently discovered the answer."

Usage:
    uv run python scripts/capture_climb.py                 # tokenizer + textkit
    uv run python scripts/capture_climb.py tokenizer 8     # one task, N versions
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Deterministic, reproducible, no API. Set before importing the swarm.
os.environ.setdefault("GLASSBOX_WORKER_LLM", "0")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "runs"

# Importable as a plain script (python scripts/capture_climb.py), not just -m.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _git_head() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def capture(task_name: str, versions: int) -> None:
    from agents import bus, run as run_mod, skill
    from tasks import load_task

    task = load_task(task_name)
    try:
        summaries = run_mod.improve_loop(task, task.goal, f"evidence-{task_name}", versions)
    finally:
        # Leave every tracked file exactly as committed: the skill back to its
        # incomplete baseline, the workspace back to its checked-in state.
        try:
            skill.reset_to_baseline(task.skill)
        except Exception as exc:  # noqa: BLE001
            print(f"[capture] skill reset skipped: {exc}")
        task.restore_workspace()

    leaderboard = sorted(
        ({"version": v, "accuracy": a} for v, a in bus.get_leaderboard(task_name)),
        key=lambda r: r["version"],
    )
    meta = bus.get_planner_meta(task_name)
    artifact = {
        "task": task_name,
        "goal": task.goal,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "git_commit": _git_head(),
        "how": (
            "uv run python scripts/capture_climb.py with GLASSBOX_WORKER_LLM=0 "
            "(deterministic curriculum). Each version's accuracy is the real oracle "
            "(tiktoken gpt2 exact token-id diff) or pytest score of the rebuilt artifact."
        ),
        "caveat_wall_ms": (
            "wall_ms is a single cold subprocess invocation (macOS first-exec "
            "code-sign cost dominates, ~270ms); it is NOT steady-state tokenize "
            "latency. See docs/runs/tokenizer-perf.md."
        ),
        "versions": summaries,
        "leaderboard": leaderboard,
        "per_version_meta": {str(k): meta[k] for k in sorted(meta)},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{task_name}-climb.json"
    dest.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    curve = ", ".join(f"v{s['version']}={s['accuracy']:.4f}" for s in summaries)
    print(f"wrote {dest.relative_to(ROOT)}: {curve}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        capture(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8)
    else:
        capture("tokenizer", 8)
        capture("textkit", 8)
