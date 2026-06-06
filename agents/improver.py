"""Improver: schedule the next planner version by adding one missing category.

This stands in for the Phase 4 Weave-driven improver. It implements a simple,
deterministic, monotonic schedule over the category coverage order: planner v1
covers just the foundational ``ascii`` category, and each subsequent version adds
exactly ONE more category from CATEGORY_ORDER. So the allowed-caps set grows
monotonically (v_n is always a superset of v_{n-1}) and accuracy climbs by one
corpus slice per version until every category is covered (accuracy 1.0).

It emits a ``planner_rewrite`` event so the cockpit bumps the version badge, and
returns the next version plus the categories that next version is allowed to
plan.

Interface other pillars build on:
    improve(run_id, planner_version, accuracy, caps) -> dict
    allowed_caps_for_version(version) -> list[str]
    current_skill() -> str
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from . import bus  # noqa: E402
from .planner import CATEGORY_ORDER  # noqa: E402

SKILL_PATH = Path(__file__).resolve().parent / "planner" / "SKILL.md"


def current_skill() -> str:
    """Return the current planner skill text."""
    return SKILL_PATH.read_text(encoding="utf-8")


def allowed_caps_for_version(version: int) -> list[str]:
    """The categories planner version ``version`` is allowed to cover.

    v1 -> the first category (``ascii``); each later version adds the next
    category in CATEGORY_ORDER. Clamped so v >= len(CATEGORY_ORDER) covers all
    categories. Always at least the foundational category. Deterministic and
    monotonic: version n's list is a prefix of (and so a subset of) version n+1's.
    """
    n = max(1, int(version))
    count = min(n, len(CATEGORY_ORDER))
    return CATEGORY_ORDER[:count]


def schedule_for_versions(versions: int) -> list[list[str]]:
    """Spread CATEGORY_ORDER across ``versions`` cycles so the LAST reaches 1.0.

    Returns a list of ``versions`` allowed-caps prefixes. Each is a prefix of
    CATEGORY_ORDER, the list is monotonically growing (cycle n's caps are a
    subset of cycle n+1's), cycle 1 always starts at the foundational ``ascii``
    category, and the final cycle always covers ALL categories (accuracy 1.0).

    With ``versions == len(CATEGORY_ORDER)`` this is exactly "add one category
    per version". With fewer versions the categories are distributed so the curve
    still climbs strictly and tops out at full coverage on the last cycle; with
    more versions the tail cycles repeat full coverage (accuracy stays 1.0).
    """
    total = len(CATEGORY_ORDER)
    v = max(1, int(versions))
    out: list[list[str]] = []
    prev = 0
    for n in range(1, v + 1):
        # Linearly interpolate the prefix length so cycle v hits `total`, and
        # never go backwards (monotonic) nor below 1 (always cover ascii).
        count = max(1, round(n * total / v))
        count = max(count, prev)  # monotonic guard
        count = min(count, total)
        out.append(CATEGORY_ORDER[:count])
        prev = count
    return out


@weave.op()
def improve(
    run_id: str,
    planner_version: int,
    accuracy: float,
    caps: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """Propose planner v(n+1): add the next missing category to the schedule.

    Deterministic schedule (stands in for the Weave-driven improver): the next
    version's allowed caps are ``allowed_caps_for_version(planner_version + 1)``,
    which is the current prefix of CATEGORY_ORDER plus exactly one more category.
    Emits a ``planner_rewrite`` event and returns {from_version, next_version,
    next_allowed_caps, added_category, gap_categories}.
    """
    next_version = planner_version + 1
    prev_allowed = allowed_caps_for_version(planner_version)
    next_allowed = allowed_caps_for_version(next_version)
    added = [c for c in next_allowed if c not in prev_allowed]
    gap = [c for c in CATEGORY_ORDER if c not in next_allowed]

    bus.emit_type(
        "planner_rewrite",
        run_id,
        planner_version=next_version,
        agent="improver",
        title=f"planner v{next_version} adds {added[0] if added else 'nothing'}",
        payload={
            "from_version": planner_version,
            "to_version": next_version,
            "prev_accuracy": accuracy,
            "next_allowed_caps": next_allowed,
            "added_category": added[0] if added else None,
            "gap_categories": gap,
        },
    )
    return {
        "from_version": planner_version,
        "next_version": next_version,
        "next_allowed_caps": next_allowed,
        "added_category": added[0] if added else None,
        "gap_categories": gap,
    }
