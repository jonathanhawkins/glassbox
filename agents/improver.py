"""Improver: rewrite the planner SKILL to cover the next failing category.

This is the genuine self-improvement step. The validator grades a run with the
real tiktoken oracle and reports which input CATEGORIES are still failing. The
improver:

  1. reads the SKILL coverage block (the source of truth for what the plan
     covers) and computes the missing categories (the 7 scoring categories minus
     the covered set, or the validator's ``failed_categories``);
  2. picks the highest-impact missing one by the canonical category order;
  3. calls the LLM to REWRITE agents/planner/SKILL.md so the coverage block gains
     that category AND a dated rationale section is appended;
  4. falls back to a deterministic edit (add the category + a templated rationale)
     if the LLM is unavailable or returns something that does not parse or does
     not grow the coverage by EXACTLY the intended category;
  5. snapshots the resulting skill to agents/planner/history/v{n+1}.md;
  6. emits ``plan_gap_found`` (payload {category, accuracy}) and
     ``planner_rewrite`` (payload {from_version, to_version, added_category}).

So between cycles the skill materially evolves v1 -> vN, and because planner.plan
reads the coverage block, the next cycle plans one more category and the curve
climbs as a real consequence of the rewrite. ``improve`` is a ``@weave.op`` so the
rewrite and its LLM call are traced under the cycle.

Interface other pillars build on:
    improve(run_id, planner_version, accuracy, failed_categories, caps) -> dict
    allowed_caps_for_version(version) -> list[str]
    schedule_for_versions(versions) -> list[list[str]]
    current_skill() -> str
"""
from __future__ import annotations

import datetime as _dt
from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import weave  # noqa: E402

from . import bus, llm, skill  # noqa: E402
from .skill import CATEGORY_ORDER, SKILL_PATH  # noqa: E402


def current_skill() -> str:
    """Return the current planner skill text."""
    return skill.read_skill(SKILL_PATH)


def allowed_caps_for_version(version: int) -> list[str]:
    """The categories a clamped, monotonic schedule would cover at ``version``.

    v1 -> the first category (``ascii``); each later version adds the next
    category in CATEGORY_ORDER, clamped at full coverage. Kept for the legacy
    ``climb_loop`` fallback and for callers that want a deterministic prefix
    without touching the SKILL file.
    """
    n = max(1, int(version))
    count = min(n, len(CATEGORY_ORDER))
    return CATEGORY_ORDER[:count]


def schedule_for_versions(versions: int) -> list[list[str]]:
    """Spread CATEGORY_ORDER across ``versions`` cycles so the LAST reaches 1.0.

    Returns a list of ``versions`` allowed-caps prefixes (monotonic, starting at
    ``ascii``, ending at full coverage). Used by the legacy ``climb_loop``
    fallback; the genuine loop instead grows the SKILL coverage block.
    """
    total = len(CATEGORY_ORDER)
    v = max(1, int(versions))
    out: list[list[str]] = []
    prev = 0
    for n in range(1, v + 1):
        count = max(1, round(n * total / v))
        count = max(count, prev)
        count = min(count, total)
        out.append(CATEGORY_ORDER[:count])
        prev = count
    return out


def _rationale_heading(next_version: int) -> str:
    """The exact markdown heading the rationale section must use."""
    return f"## Revision v{next_version}"


def _rationale_section(
    next_version: int, from_version: int, category: str, accuracy: float
) -> str:
    """A short dated rationale block appended to the skill on each rewrite."""
    today = _dt.date.today().isoformat()
    return (
        f"\n{_rationale_heading(next_version)}: the v{from_version} eval showed "
        f"{category} inputs failing (accuracy {accuracy:.2f}); add a bead to "
        f"cover {category}. ({today})\n"
    )


def _deterministic_rewrite(
    text: str,
    next_version: int,
    from_version: int,
    category: str,
    accuracy: float,
) -> str:
    """Add ``category`` to the coverage block and append a dated rationale.

    This is the fallback the LLM rewrite is validated against and falls back to.
    """
    grown = skill.add_category(text, category)
    return grown + _rationale_section(next_version, from_version, category, accuracy)


def _llm_rewrite(
    text: str,
    next_version: int,
    from_version: int,
    category: str,
    accuracy: float,
) -> Optional[str]:
    """Ask the LLM to rewrite the skill: add ``category`` + a dated rationale.

    Returns the new skill text, or None if the LLM is unavailable or its output
    does not satisfy the structural checks (coverage block parses and grew by
    EXACTLY ``category``, and a ``## Revision v{n}`` heading is present). The
    caller validates again and falls back to the deterministic edit if needed.
    """
    current = skill.parse_coverage(text)
    target = sorted(set(current) | {category})
    messages = [
        {
            "role": "system",
            "content": (
                "You are the Glassbox improver. You edit the planner's skill "
                "markdown. Return the ENTIRE rewritten markdown document and "
                "nothing else (no code fences, no commentary)."
            ),
        },
        {
            "role": "user",
            "content": (
                "Here is the current planner SKILL.md:\n\n"
                f"{text}\n\n----\n"
                f"The latest eval (planner v{from_version}) scored accuracy "
                f"{accuracy:.2f}. The input category '{category}' is failing "
                "because the plan does not cover it. Rewrite the document so "
                "that:\n"
                f"1. the coverage block (between the {skill._START} and "
                f"{skill._END} markers) lists EXACTLY these categories, one per "
                f"line: {', '.join(target)}.\n"
                f"2. you append a new section that begins with the heading "
                f"'{_rationale_heading(next_version)}:' explaining that the "
                f"v{from_version} eval showed {category} inputs failing "
                f"(accuracy {accuracy:.2f}) so a bead is added to cover "
                f"{category}.\n"
                "Keep all other content (the human-readable bead descriptions, "
                "the capability set, the rules). Do not invent categories. "
                "Return the whole markdown document now."
            ),
        },
    ]
    try:
        reply = llm.chat(messages, temperature=0.0, max_tokens=4096)
    except llm.LLMError as exc:
        print(f"[improver] LLM unavailable, using deterministic rewrite: {exc}")
        return None

    candidate = reply.strip()
    # Strip an accidental surrounding code fence if the model added one.
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        candidate = "\n".join(lines).strip()

    # Structural validation: the coverage block must parse and equal the target,
    # and the dated rationale heading must be present. Anything else -> fallback.
    try:
        got = skill.parse_coverage(candidate)
    except ValueError as exc:
        print(f"[improver] LLM rewrite had no valid coverage block: {exc}")
        return None
    if set(got) != set(target):
        print(
            "[improver] LLM coverage "
            f"{got} != target {target}; using deterministic rewrite"
        )
        return None
    if _rationale_heading(next_version) not in candidate:
        print("[improver] LLM rewrite missing rationale heading; falling back")
        return None
    return candidate


@weave.op()
def improve(
    run_id: str,
    planner_version: int,
    accuracy: float,
    failed_categories: Optional[Iterable[str]] = None,
    caps: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """Rewrite SKILL.md to cover the next failing category. Returns a summary.

    Determines the highest-impact missing category (preferring one that is both
    missing from the SKILL coverage AND present in ``failed_categories``, else the
    lowest-index missing category overall), rewrites SKILL.md via the LLM (with a
    deterministic fallback) so the coverage block grows by EXACTLY that category
    plus a dated rationale, snapshots the result to history/v{n+1}.md, and emits
    ``plan_gap_found`` and ``planner_rewrite``.

    If the SKILL already covers every category (no gap), this is a no-op: it
    returns ``added_category=None`` and the unchanged coverage, and emits neither
    event. ``caps`` is accepted for interface compatibility; the source of truth
    is the SKILL coverage block, not the run's accumulated caps.

    Returns {from_version, next_version, added_category, covered, gap_categories,
    skill_path}.
    """
    llm.init_weave()
    next_version = planner_version + 1

    text = current_skill()
    covered_before = skill.parse_coverage(text)
    category = skill.next_missing_category(covered_before, failed_categories)

    if category is None:
        # Full coverage already: nothing to improve. Snapshot defensively so the
        # next version still has a history entry to read.
        skill.snapshot(next_version, text)
        return {
            "from_version": planner_version,
            "next_version": next_version,
            "added_category": None,
            "covered": covered_before,
            "gap_categories": [],
            "skill_path": str(SKILL_PATH),
        }

    # Emit the gap the cockpit animates (planner + improver pulse) BEFORE writing,
    # so the board shows the diagnosis then the rewrite.
    bus.emit_type(
        "plan_gap_found",
        run_id,
        planner_version=planner_version,
        agent="improver",
        title=f"gap: {category} failing (accuracy {accuracy:.2f})",
        payload={"category": category, "accuracy": accuracy},
    )

    new_text = _llm_rewrite(text, next_version, planner_version, category, accuracy)
    rewrite_source = "llm"
    if new_text is None:
        new_text = _deterministic_rewrite(
            text, next_version, planner_version, category, accuracy
        )
        rewrite_source = "deterministic"

    # Invariant: the coverage block must parse and must have grown by EXACTLY the
    # intended category. Assert hard (a corrupted rewrite must never ship).
    covered_after = skill.parse_coverage(new_text)
    grew = set(covered_after) - set(covered_before)
    assert grew == {category}, (
        f"rewrite must add exactly {category!r}; coverage went "
        f"{covered_before} -> {covered_after} (source={rewrite_source})"
    )

    skill.write_skill(new_text, SKILL_PATH)
    snap_path = skill.snapshot(next_version, new_text)

    gap = [c for c in CATEGORY_ORDER if c not in set(covered_after)]
    bus.emit_type(
        "planner_rewrite",
        run_id,
        planner_version=next_version,
        agent="improver",
        title=f"planner v{next_version} adds {category}",
        payload={
            "from_version": planner_version,
            "to_version": next_version,
            "added_category": category,
            "prev_accuracy": accuracy,
            "covered": covered_after,
            "gap_categories": gap,
            "rewrite_source": rewrite_source,
            "snapshot": str(snap_path),
        },
    )

    return {
        "from_version": planner_version,
        "next_version": next_version,
        "added_category": category,
        "covered": covered_after,
        "gap_categories": gap,
        "skill_path": str(SKILL_PATH),
    }
