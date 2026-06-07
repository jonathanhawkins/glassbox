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

    Each task keeps its own correctness curve (so the tokenizer and the kata never
    overwrite each other's version scores). Mirrors the TS side, which reads
    ``${REDIS.plannerScores}:${task}``.
    """
    t = (task or DEFAULT_TASK).strip() or DEFAULT_TASK
    return f"{PLANNER_SCORES}:{t}"


def make_event(
    type: str,
    run_id: str,
    *,
    planner_version: int = 0,
    agent: str = "system",
    bead_id: Optional[str] = None,
    title: str = "",
    payload: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build a canonical Glassbox event envelope."""
    if type not in EVENT_TYPES:
        raise ValueError(f"unknown event type: {type!r} (allowed: {sorted(EVENT_TYPES)})")
    return {
        "ts": int(time.time() * 1000),
        "type": type,
        "run_id": run_id,
        "planner_version": planner_version,
        "agent": agent,
        "bead_id": bead_id,
        "title": title,
        "payload": payload or {},
    }
