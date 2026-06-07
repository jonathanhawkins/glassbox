"""Improver: rewrite the planner SKILL to cover the next failing category.

This is the genuine self-improvement step. The validator grades a run with the
real tiktoken oracle and reports which input CATEGORIES are still failing. The
improver:

  1. reads the SKILL coverage block (the source of truth for what the plan
     covers) and computes the missing categories (the 7 scoring categories minus
     the covered set, or the validator's ``failed_categories``);
  2. picks the highest-impact missing one by the canonical category order;
  3. applies a deterministic coverage edit (skill.add_category, a canonical block)
     and appends a dated rationale section whose prose is LLM-authored;
  4. falls back to a templated rationale if the LLM is unavailable or its reply
     looks like leaked prompt or markup (we never ask the model for the whole
     document, only the rationale sentence, so SKILL.md stays clean);
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
import os
from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import weave  # noqa: E402

from . import bus, llm, skill  # noqa: E402
from .skill import CATEGORY_ORDER, SkillConfig  # noqa: E402


def _cfg(task: Any = None) -> SkillConfig:
    """The skill config for a task (defaults to the tokenizer skill when unset)."""
    cfg = getattr(task, "skill", None) if task is not None else None
    return cfg or skill.TOKENIZER


def current_skill(cfg: SkillConfig = skill.TOKENIZER) -> str:
    """Return the current planner skill text for ``cfg``."""
    return skill.read_skill(cfg.skill_path)


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


def _fallback_rationale(from_version: int, category: str, accuracy: float) -> str:
    """The deterministic one-line rationale used when the LLM is unavailable."""
    return (
        f"the v{from_version} eval showed {category} inputs failing "
        f"(accuracy {accuracy:.2f}), so a bead was added to cover {category}."
    )


def _rationale_section(next_version: int, rationale: str) -> str:
    """Wrap a plain-prose rationale in a clean, dated revision heading."""
    today = _dt.date.today().isoformat()
    return f"\n{_rationale_heading(next_version)}: {rationale} ({today})\n"


# Phrases that signal the model leaked the prompt or structural markup into its
# reply. A rationale containing any of these is rejected (we use the fallback),
# which keeps SKILL.md clean: we only ever insert plain prose.
_RATIONALE_REJECT = (
    "coverage:",
    "<!--",
    "-->",
    "## revision",
    "return the",
    "rewrite the document",
    "```",
    "skill.md",
    "markers",
)


def _llm_rationale(
    from_version: int,
    category: str,
    accuracy: float,
    failed: int = 0,
    unit: str = "category",
) -> Optional[str]:
    """Ask the LLM for ONLY a one or two sentence rationale (plain prose).

    Returns a sanitized rationale string, or None if the LLM is unavailable or
    its reply looks like leaked prompt or markup. We never ask the model for the
    whole document (that caused it to echo the prompt back into SKILL.md); the
    structural edit is done deterministically by skill.add_category.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You are the Glassbox improver. Reply with ONE or TWO short "
                "sentences of plain prose explaining the planner skill change. "
                "No markdown, no headings, no lists, no code, no quotes, no "
                "document, no markers. Under 240 characters."
            ),
        },
        {
            "role": "user",
            "content": (
                f"The latest planner eval (v{from_version}) scored accuracy "
                f"{accuracy:.2f}. The {unit} '{category}' was the biggest failing "
                f"gap ({failed} failing checks), so a bead to cover {category} is "
                "being added. Write the one or two sentence rationale."
            ),
        },
    ]
    # Use a standard instruct model for the short rationale. The default swarm
    # model (gpt-oss-120b) is a reasoning model that returns empty content unless
    # given a large token budget, so prefer the fast chat model here.
    model = (
        os.environ.get("GLASSBOX_RATIONALE_MODEL")
        or os.environ.get("GLASSBOX_CHAT_MODEL")
        or "meta-llama/Llama-3.3-70B-Instruct"
    )
    try:
        reply = llm.chat(messages, model=model, temperature=0.4, max_tokens=200)
    except llm.LLMError as exc:
        print(f"[improver] LLM unavailable, using deterministic rationale: {exc}")
        return None
    # Collapse whitespace/newlines into a single clean line.
    rationale = " ".join(reply.split()).strip().strip('"').strip()
    low = rationale.lower()
    if not rationale or len(rationale) > 400 or any(b in low for b in _RATIONALE_REJECT):
        print("[improver] LLM rationale rejected (empty/too long/leaked); fallback")
        return None
    return rationale


@weave.op()
def improve(
    task: Any,
    run_id: str,
    planner_version: int,
    accuracy: float,
    failed_categories: Optional[Iterable[str]] = None,
    caps: Optional[Iterable[str]] = None,
    failing: Optional[Iterable[dict]] = None,
) -> dict[str, Any]:
    """Rewrite SKILL.md to cover the next failing category. Returns a summary.

    Determines the highest-impact missing category (preferring one that is both
    missing from the SKILL coverage AND present in ``failed_categories``, else the
    lowest-index missing category overall), grows the coverage block by EXACTLY
    that category via a deterministic edit, appends an LLM-authored dated rationale
    (templated fallback), snapshots the result to history/v{n+1}.md, and emits
    ``plan_gap_found`` and ``planner_rewrite``.

    If the SKILL already covers every category (no gap), this is a no-op: it
    returns ``added_category=None`` and the unchanged coverage, and emits neither
    event. ``caps`` is accepted for interface compatibility; the source of truth
    is the SKILL coverage block, not the run's accumulated caps.

    Returns {from_version, next_version, added_category, covered, gap_categories,
    skill_path}.
    """
    llm.init_weave()
    cfg = _cfg(task)
    next_version = planner_version + 1

    text = current_skill(cfg)
    covered_before = skill.parse_coverage(text, cfg)
    failing = list(failing) if failing else []
    # Prefer the biggest real gap from the eval (data-driven, varies per run);
    # fall back to the lowest-index missing group when no magnitudes are given.
    if failing:
        category = skill.next_gap_by_impact(covered_before, failing, cfg)
    else:
        category = skill.next_missing_category(covered_before, failed_categories, cfg)

    if category is None:
        # Full coverage already: nothing to improve. Snapshot defensively so the
        # next version still has a history entry to read.
        skill.snapshot(next_version, text, cfg)
        return {
            "from_version": planner_version,
            "next_version": next_version,
            "added_category": None,
            "covered": covered_before,
            "gap_categories": [],
            "skill_path": str(cfg.skill_path),
        }

    # How many lines of the chosen category the eval flagged (for the cockpit's
    # "what the improver found" readout and the rationale prose).
    chosen_failed = next(
        (int(f.get("failed", 0)) for f in failing if f.get("category") == category),
        0,
    )

    # Emit the gap the cockpit animates (planner + improver pulse) BEFORE writing,
    # so the board shows the diagnosis then the rewrite. The payload carries the
    # full per-category breakdown so the UI can show what the eval found.
    bus.emit_type(
        "plan_gap_found",
        run_id,
        planner_version=planner_version,
        agent="improver",
        title=f"gap: {category} failing (accuracy {accuracy:.2f})",
        payload={
            "category": category,
            "accuracy": accuracy,
            "failed": chosen_failed,
            "failing": failing,
        },
    )

    # Clean structural edit (deterministic, canonical coverage block) plus an
    # LLM-authored plain-prose rationale (sanitized), with a templated fallback.
    grown = skill.add_category(text, category, cfg)
    rationale = _llm_rationale(
        planner_version, category, accuracy, chosen_failed, unit=cfg.unit
    )
    rewrite_source = "llm"
    if rationale is None:
        rationale = _fallback_rationale(planner_version, category, accuracy)
        rewrite_source = "deterministic"
    new_text = grown + _rationale_section(next_version, rationale)

    # Invariant: the coverage block must parse and must have grown by EXACTLY the
    # intended category. Assert hard (a corrupted rewrite must never ship).
    covered_after = skill.parse_coverage(new_text, cfg)
    grew = set(covered_after) - set(covered_before)
    assert grew == {category}, (
        f"rewrite must add exactly {category!r}; coverage went "
        f"{covered_before} -> {covered_after} (source={rewrite_source})"
    )

    skill.write_skill(new_text, cfg.skill_path)
    snap_path = skill.snapshot(next_version, new_text, cfg)

    gap = [c for c in cfg.order if c not in set(covered_after)]
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

    bus.emit_mail(
        run_id,
        "improver",
        "planner",
        f"Skill rewrite: +{category} (v{planner_version}->v{next_version})",
        planner_version=next_version,
        body=f"added a bead for {category}; you now cover {len(covered_after)}/{len(cfg.order)}",
        kind="rewrite",
        cap=category,
    )

    return {
        "from_version": planner_version,
        "next_version": next_version,
        "added_category": category,
        "covered": covered_after,
        "gap_categories": gap,
        "skill_path": str(cfg.skill_path),
    }
