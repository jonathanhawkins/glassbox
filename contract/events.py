"""The single integration contract between the swarm and the cockpit (Python side).

Mirrors contract/index.ts. The canonical source of truth for channel names,
event types, and ports is glassbox.contract.json, loaded here at import time.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

_CONTRACT = json.loads((Path(__file__).parent / "glassbox.contract.json").read_text())

PORTS: dict[str, int] = _CONTRACT["ports"]
REDIS: dict[str, str] = _CONTRACT["redis"]

EVENTS_STREAM: str = REDIS["eventsStream"]
PLANNER_SCORES: str = REDIS["plannerScores"]
PLANNER_META: str = REDIS["plannerMeta"]
BEADS_STATE: str = REDIS["beadsState"]
SKILL_STATE: str = REDIS["skillState"]
RUNS_LIST: str = REDIS["runsList"]
RUN_META_PREFIX: str = REDIS["runMetaPrefix"]

EVENT_TYPES: set[str] = set(_CONTRACT["eventTypes"])
AGENT_STATUS: list[str] = _CONTRACT["agentStatus"]
AGENTS: list[str] = _CONTRACT["agents"]

DEFAULT_TASK = "tokenizer"


def planner_scores_key(task: str = DEFAULT_TASK) -> str:
    """The per-task leaderboard sorted-set key.

    Each task keeps its own correctness curve (so the tokenizer and the textkit never
    overwrite each other's version scores). Mirrors the TS side, which reads
    ``${REDIS.plannerScores}:${task}``.
    """
    t = (task or DEFAULT_TASK).strip() or DEFAULT_TASK
    return f"{PLANNER_SCORES}:{t}"


def planner_meta_key(task: str = DEFAULT_TASK) -> str:
    """The per-task version-metadata hash key (companion to the scores sorted set).

    A Redis hash keyed by ``str(version)`` holding a JSON blob per planner version
    (accuracy, added_category, wall_ms, weave_eval_url, status, gap_source). Version
    indexed, like the leaderboard, so the cockpit can show a ranked, Weave-linked row
    per version that survives a reload. Mirrors the TS side, which reads
    ``${REDIS.plannerMeta}:${task}``.
    """
    t = (task or DEFAULT_TASK).strip() or DEFAULT_TASK
    return f"{PLANNER_META}:{t}"


def make_event(
    type: str,
    run_id: str,
    *,
    task: str = DEFAULT_TASK,
    planner_version: int = 0,
    agent: str = "system",
    bead_id: Optional[str] = None,
    title: str = "",
    payload: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build a canonical Glassbox event envelope.

    ``task`` scopes the event to a build target. The stream is global (all tasks
    share ``glassbox:events``) but leaderboards and the cockpit board are per-task,
    so every envelope carries the task it belongs to and the cockpit drops events
    that do not match its active task.
    """
    if type not in EVENT_TYPES:
        raise ValueError(f"unknown event type: {type!r} (allowed: {sorted(EVENT_TYPES)})")
    return {
        "ts": int(time.time() * 1000),
        "type": type,
        "run_id": run_id,
        "task": (task or DEFAULT_TASK).strip() or DEFAULT_TASK,
        "planner_version": planner_version,
        "agent": agent,
        "bead_id": bead_id,
        "title": title,
        "payload": payload or {},
    }
