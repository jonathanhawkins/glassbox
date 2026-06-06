"""The planner: decompose the goal into the 8-bead capability graph.

``plan(goal, run_id, planner_version)`` reads the editable skill at
agents/planner/SKILL.md, asks the LLM for a JSON array of beads
(``[{title, capability, deps}]``), and falls back to the deterministic
canonical plan if the LLM is unavailable. It then:

  - emits a ``plan_started`` event,
  - creates each bead via beads.create (wiring deps title -> id),
  - emits a ``bead_created`` event per bead with payload {"capability": tag},

and returns the bead list including the assigned bead ids.

The capability tag on each bead is the load-bearing convention: the worker maps
bead -> capability to "implement" it (adds the capability to the run) and the
validator runs the oracle gated on the accumulated capabilities.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import weave  # noqa: E402

from . import beads, bus, llm  # noqa: E402

SKILL_PATH = Path(__file__).resolve().parent / "planner" / "SKILL.md"

# The allowed capability tags. The worker/validator gate the oracle on these.
CAPABILITIES = {
    "merges",
    "regex",
    "byte_level",
    "whitespace",
    "special",
    "encode",
    "decode",
    "harness",
}

# Canonical deterministic decomposition. Used as the fallback and as the
# ground-truth dependency shape. deps reference other titles in this list.
CANONICAL_PLAN: list[dict[str, Any]] = [
    {"title": "load vocab and merge ranks", "capability": "merges", "deps": []},
    {"title": "byte-level encoding", "capability": "byte_level", "deps": []},
    {"title": "regex pre-tokenization", "capability": "regex", "deps": []},
    {"title": "special-token handling", "capability": "special", "deps": []},
    {
        "title": "BPE merge loop",
        "capability": "merges",
        "deps": ["load vocab and merge ranks"],
    },
    {
        "title": "encode end to end",
        "capability": "encode",
        "deps": [
            "load vocab and merge ranks",
            "BPE merge loop",
            "byte-level encoding",
            "regex pre-tokenization",
            "special-token handling",
        ],
    },
    {
        "title": "decode end to end",
        "capability": "decode",
        "deps": ["load vocab and merge ranks", "byte-level encoding"],
    },
    {"title": "oracle diff harness", "capability": "harness", "deps": []},
]


def read_skill() -> str:
    """Return the current planner skill text (the editable SKILL.md)."""
    return SKILL_PATH.read_text(encoding="utf-8")


def _extract_json_array(text: str) -> Optional[list[Any]]:
    """Pull the first top-level JSON array out of an LLM reply, if any.

    Tolerates code fences and surrounding prose. Returns None if nothing parses.
    """
    # Strip ```json ... ``` fences if present.
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if candidate is None:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            candidate = text[start : end + 1]
    if candidate is None:
        return None
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


def _normalize_plan(raw: list[Any]) -> Optional[list[dict[str, Any]]]:
    """Validate and clean an LLM-proposed plan against the contract.

    Each item needs a non-empty title and a capability in the allowed set; deps
    must reference titles present in the plan. Returns None if the plan is too
    malformed to trust (the caller then falls back to CANONICAL_PLAN).
    """
    cleaned: list[dict[str, Any]] = []
    titles: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            return None
        title = str(item.get("title", "")).strip()
        cap = str(item.get("capability", "")).strip()
        if not title or cap not in CAPABILITIES:
            return None
        deps = item.get("deps") or []
        if not isinstance(deps, list):
            return None
        deps = [str(d).strip() for d in deps if str(d).strip()]
        cleaned.append({"title": title, "capability": cap, "deps": deps})
        titles.add(title)
    if not cleaned:
        return None
    # Drop dangling deps (titles not in the plan) so wiring never fails.
    for bead in cleaned:
        bead["deps"] = [d for d in bead["deps"] if d in titles]
    # Topologically order so a dep is always created before its dependents.
    return _topo_sort(cleaned)


def _topo_sort(plan: list[dict[str, Any]]) -> Optional[list[dict[str, Any]]]:
    """Order beads so every dep precedes its dependents. None on a cycle."""
    by_title = {b["title"]: b for b in plan}
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    visiting: set[str] = set()

    def visit(title: str) -> bool:
        if title in seen:
            return True
        if title in visiting:
            return False  # cycle
        visiting.add(title)
        for dep in by_title[title]["deps"]:
            if dep in by_title and not visit(dep):
                return False
        visiting.discard(title)
        seen.add(title)
        ordered.append(by_title[title])
        return True

    for b in plan:
        if not visit(b["title"]):
            return None
    return ordered


def _plan_from_llm(goal: str) -> Optional[list[dict[str, Any]]]:
    """Ask the LLM for a bead plan. Returns a normalized plan or None."""
    skill = read_skill()
    messages = [
        {
            "role": "system",
            "content": (
                "You are the Glassbox planner. Follow the skill exactly and "
                "emit ONLY a JSON array of bead objects, no prose, no code "
                "fences."
            ),
        },
        {
            "role": "user",
            "content": (
                f"{skill}\n\n----\nGOAL: {goal}\n\n"
                "Emit the JSON array of 8 beads now."
            ),
        },
    ]
    try:
        reply = llm.chat(messages, temperature=0.0, max_tokens=4096)
    except llm.LLMError as exc:
        print(f"[planner] LLM unavailable, using deterministic plan: {exc}")
        return None
    raw = _extract_json_array(reply)
    if raw is None:
        print("[planner] could not parse LLM plan, using deterministic plan")
        return None
    normalized = _normalize_plan(raw)
    if normalized is None:
        print("[planner] LLM plan failed validation, using deterministic plan")
        return None
    return normalized


@weave.op()
def plan(goal: str, run_id: str, planner_version: int = 1) -> list[dict[str, Any]]:
    """Decompose ``goal`` into beads, create them, emit events, return the list.

    Returns a list of bead dicts: {title, capability, deps (titles), id,
    dep_ids}. ``id`` is the created bead id; ``dep_ids`` are the bead ids this
    bead depends on. This is the structure the coordinator/worker consume.
    """
    llm.init_weave()

    source = "llm"
    spec = _plan_from_llm(goal)
    if spec is None:
        spec = [dict(b) for b in CANONICAL_PLAN]
        source = "deterministic"

    bus.emit_type(
        "plan_started",
        run_id,
        planner_version=planner_version,
        agent="planner",
        title=goal,
        payload={"source": source, "bead_count": len(spec)},
    )

    # Create beads in topological order, wiring deps by title -> created id.
    title_to_id: dict[str, str] = {}
    result: list[dict[str, Any]] = []
    for bead in spec:
        dep_ids = [title_to_id[d] for d in bead["deps"] if d in title_to_id]
        bead_id = beads.create(
            bead["title"],
            body=f"capability={bead['capability']}",
            btype="task",
            priority=2,
            deps=dep_ids or None,
        )
        title_to_id[bead["title"]] = bead_id

        bus.emit_type(
            "bead_created",
            run_id,
            planner_version=planner_version,
            agent="planner",
            bead_id=bead_id,
            title=bead["title"],
            payload={"capability": bead["capability"], "deps": dep_ids},
        )

        result.append(
            {
                "id": bead_id,
                "title": bead["title"],
                "capability": bead["capability"],
                "deps": bead["deps"],
                "dep_ids": dep_ids,
            }
        )

    bus.set_agent_status(run_id, "planner", "done", planner_version=planner_version)
    return result


if __name__ == "__main__":
    import sys

    g = sys.argv[1] if len(sys.argv) > 1 else "port the BPE tokenizer to Rust"
    rid = sys.argv[2] if len(sys.argv) > 2 else "dev"
    ver = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    out = plan(g, rid, ver)
    print(json.dumps(out, indent=2))
