"""The planner: decompose the goal into the capability graph the SKILL covers.

The planner's skill file (agents/planner/SKILL.md) is the SOURCE OF TRUTH for
which input categories the plan covers: it carries a machine-readable coverage
block (see agents/skill.py) that the planner parses deterministically. The set of
beads is exactly:

    foundational ``ascii`` + one bead per covered category + structural ``harness``

so the plan grows precisely as the improver rewrites the coverage block. The LLM
may still be asked to phrase nice bead titles/descriptions from the skill, but the
SET OF CAPABILITIES never depends on the LLM: it always equals the parsed
coverage. If the LLM is unavailable or returns a set that does not match the
coverage, the planner uses canonical titles instead.

``plan(goal, run_id, planner_version, allowed_caps)`` then:

  - emits a ``plan_started`` event,
  - creates each bead via beads.create (wiring deps title -> id),
  - emits a ``bead_created`` event per bead with payload {capability, deps},

and returns the bead list including the assigned bead ids.

The capability tag on each bead is the load-bearing convention: it is one of the
7 scoring CATEGORIES from contract/CAPABILITIES.md (plus the structural
``harness``). The worker adds a bead's category to the run's accumulated set and
the validator runs the oracle gated on that set, so an incomplete plan genuinely
fails a class of inputs and the correctness curve climbs honestly as the improver
adds the missing category beads to the skill.

``allowed_caps`` lets a caller (climb_loop, the /run endpoint) restrict a plan:
when given, the category beads are INTERSECTED with it, but the foundational
``ascii`` bead and the structural ``harness`` bead are ALWAYS kept (everything
depends on ascii; harness is the pipeline). ``allowed_caps=None`` means "use the
SKILL coverage as-is".
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import weave  # noqa: E402

from . import beads, bus, llm, skill  # noqa: E402
from .skill import (  # noqa: E402
    CATEGORY_ORDER,
    FOUNDATIONAL,
    SKILL_PATH,
    STRUCTURAL,
    canonical_title,
)

# All allowed capability tags the planner/worker/validator agree on.
CAPABILITIES = set(CATEGORY_ORDER) | {STRUCTURAL}


def read_skill() -> str:
    """Return the current planner skill text (the editable SKILL.md)."""
    return skill.read_skill(SKILL_PATH)


def covered_categories() -> list[str]:
    """The categories the SKILL coverage block currently covers (ordered).

    Parsed deterministically from SKILL.md (never via the LLM). This is the set
    the planner turns into category beads.
    """
    return skill.covered_categories(SKILL_PATH)


def _plan_from_coverage(
    covered: list[str], allowed_caps: Optional[Iterable[str]] = None
) -> list[dict[str, Any]]:
    """Build the deterministic bead spec from the SKILL coverage set.

    The spec is exactly: the foundational ``ascii`` bead, one bead per covered
    scoring category, and the structural ``harness`` join bead. Every category
    bead depends on ``ascii``; ``harness`` depends on all the category beads.
    Titles come from the canonical map so deps (wired by title) always line up.

    ``allowed_caps`` (when given) intersects the covered categories, but ``ascii``
    and ``harness`` are always kept, so a caller can request a narrower plan
    without breaking the foundational/join wiring.
    """
    cats = [c for c in CATEGORY_ORDER if c in set(covered)]
    if allowed_caps is not None:
        allow = set(allowed_caps) | {FOUNDATIONAL, STRUCTURAL}
        cats = [c for c in cats if c in allow]
    # ascii is foundational and always present.
    if FOUNDATIONAL not in cats:
        cats = [FOUNDATIONAL, *cats]

    ascii_title = canonical_title(FOUNDATIONAL)
    spec: list[dict[str, Any]] = [
        {"title": ascii_title, "capability": FOUNDATIONAL, "deps": []}
    ]
    middle_titles: list[str] = []
    for cat in cats:
        if cat == FOUNDATIONAL:
            continue
        title = canonical_title(cat)
        spec.append({"title": title, "capability": cat, "deps": [ascii_title]})
        middle_titles.append(title)
    # The harness join depends on ascii plus every covered category bead.
    spec.append(
        {
            "title": canonical_title(STRUCTURAL),
            "capability": STRUCTURAL,
            "deps": [ascii_title, *middle_titles],
        }
    )
    return spec


def _extract_json_array(text: str) -> Optional[list[Any]]:
    """Pull the first top-level JSON array out of an LLM reply, if any.

    Tolerates code fences and surrounding prose. Returns None if nothing parses.
    """
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
    malformed to trust (the caller then falls back to canonical titles built from
    the SKILL coverage).
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
    for bead in cleaned:
        bead["deps"] = [d for d in bead["deps"] if d in titles]
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


def _plan_from_llm(
    goal: str, required_caps: set[str]
) -> Optional[list[dict[str, Any]]]:
    """Ask the LLM to phrase the beads for exactly ``required_caps``.

    The SET of capabilities is NOT up to the LLM: it is the SKILL coverage
    (foundational ascii + covered categories + harness), passed in as
    ``required_caps``. The LLM only supplies nice titles/order. We accept its
    plan only if its capability set EXACTLY equals ``required_caps``; otherwise we
    return None so the caller uses canonical titles. This keeps the curve a real
    consequence of the skill, never of LLM whim.
    """
    skill_text = read_skill()
    caps_line = ", ".join(sorted(required_caps))
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
                f"{skill_text}\n\n----\nGOAL: {goal}\n\n"
                "Emit a JSON array with EXACTLY one bead per capability in this "
                f"set and NO others: {caps_line}. Each bead is "
                '{"title","capability","deps"}. Use the capability tags exactly '
                "as given. The `ascii` bead has no deps; every other category "
                "bead depends on the `ascii` bead by its title; the `harness` "
                "bead depends on every category bead by title. Emit the array "
                "now."
            ),
        },
    ]
    try:
        reply = llm.chat(messages, temperature=0.0, max_tokens=4096)
    except llm.LLMError as exc:
        print(f"[planner] LLM unavailable, using canonical titles: {exc}")
        return None
    raw = _extract_json_array(reply)
    if raw is None:
        print("[planner] could not parse LLM plan, using canonical titles")
        return None
    normalized = _normalize_plan(raw)
    if normalized is None:
        print("[planner] LLM plan failed validation, using canonical titles")
        return None
    # The capability set is load-bearing: reject any plan that does not cover
    # EXACTLY the SKILL coverage (the LLM is only allowed to choose phrasing).
    got = {b["capability"] for b in normalized}
    if got != required_caps:
        print(
            "[planner] LLM caps "
            f"{sorted(got)} != coverage {sorted(required_caps)}; "
            "using canonical titles"
        )
        return None
    return normalized


@weave.op()
def plan(
    goal: str,
    run_id: str,
    planner_version: int = 1,
    allowed_caps: Optional[Iterable[str]] = None,
) -> list[dict[str, Any]]:
    """Decompose ``goal`` into beads, create them, emit events, return the list.

    The capability SET is taken from the SKILL coverage block (foundational
    ``ascii`` + one bead per covered category + structural ``harness``), parsed
    deterministically. When ``allowed_caps`` is given it INTERSECTS the covered
    categories (``ascii`` and ``harness`` are always kept), so a caller can plan a
    narrower run. ``allowed_caps=None`` plans exactly the SKILL coverage.

    The LLM is consulted only to phrase titles for that exact capability set; if
    it is unavailable or proposes a different set, canonical titles are used. So
    the plan size and categories are a genuine consequence of the skill, not the
    model.

    Returns a list of bead dicts: {id, title, capability, deps (titles),
    dep_ids}. ``id`` is the created bead id; ``dep_ids`` are the bead ids this
    bead depends on. This is the structure the coordinator/worker consume.
    """
    llm.init_weave()

    # SKILL coverage is the source of truth for which categories the plan covers.
    covered = covered_categories()
    base_spec = _plan_from_coverage(covered, allowed_caps=allowed_caps)
    required_caps = {b["capability"] for b in base_spec}

    # Let the LLM phrase the beads, but only for EXACTLY the required cap set.
    source = "llm"
    spec = _plan_from_llm(goal, required_caps)
    if spec is None:
        spec = base_spec
        source = "skill-canonical"

    ordered = _topo_sort(spec)
    if ordered is not None:
        spec = ordered

    allowed_list = sorted(allowed_caps) if allowed_caps is not None else None
    bus.emit_type(
        "plan_started",
        run_id,
        planner_version=planner_version,
        agent="planner",
        title=goal,
        payload={
            "source": source,
            "bead_count": len(spec),
            "allowed_caps": allowed_list,
            "covered": covered,
            "capabilities": [b["capability"] for b in spec],
        },
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
