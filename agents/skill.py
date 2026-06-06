"""The planner SKILL.md as the source of truth for category coverage.

The planner skill (agents/planner/SKILL.md) carries a machine-readable coverage
block delimited by ``<!-- coverage:start -->`` and ``<!-- coverage:end -->``, one
input category per line. This module parses that block deterministically (never
via the LLM) and rewrites it when the improver adds a category, so the skill file
is the genuine lever the self-improvement loop pulls: planner.plan reads the
covered set to decide which beads to emit, and improver.improve grows the set
based on the Weave-graded category failures.

It also owns the small filesystem dance the loop needs: resetting the live skill
from the intentionally-incomplete baseline, and snapshotting each version into
agents/planner/history/v{n}.md so the board (and the verifier) can show the
coverage block GROW v1 -> vN.

Public interface (planner, improver, run, server call these):
    read_skill(path=SKILL_PATH) -> str
    write_skill(text, path=SKILL_PATH) -> None
    parse_coverage(text) -> list[str]            ordered, deduped, valid only
    covered_categories(path=SKILL_PATH) -> list[str]
    set_coverage(text, categories) -> str        rewrite the block in `text`
    add_category(text, category) -> str          add one category to the block
    reset_to_baseline() -> str                   copy baseline -> live, return text
    snapshot(version, text=None) -> Path         write history/v{n}.md
    history() -> list[dict]                       [{version, path, covered}]
    canonical_title(category) -> str
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Iterable, Optional

# The canonical category order the planner/improver/validator agree on. Mirrors
# contract/CAPABILITIES.md. ascii is foundational (highest impact first); emoji
# is last. The improver always fills the lowest-index missing category next.
CATEGORY_ORDER: list[str] = [
    "ascii",
    "punctuation",
    "numbers",
    "code",
    "unicode",
    "whitespace",
    "emoji",
]

FOUNDATIONAL = "ascii"
STRUCTURAL = "harness"

# Valid coverage entries are exactly the 7 scoring categories. The structural
# ``harness`` is always emitted by the planner and is NOT part of the coverage
# block (it has no scoring effect), so it is intentionally excluded here.
_VALID = set(CATEGORY_ORDER)

# Canonical bead title per capability. Kept in sync with SKILL.md so the
# deterministic plan and the LLM plan use the same titles (deps wire by title).
CANONICAL_TITLE: dict[str, str] = {
    "ascii": "Core BPE and vocab load (plain ASCII text)",
    "punctuation": "Regex pre-tokenization for punctuation and contractions",
    "numbers": "Numeric token handling",
    "code": "Source-code token handling",
    "unicode": "Byte-level UTF-8 for unicode text",
    "whitespace": "Whitespace and spacing fidelity",
    "emoji": "Emoji and multibyte sequences",
    "harness": "Encode/decode pipeline and oracle diff harness",
}

_PLANNER_DIR = Path(__file__).resolve().parent / "planner"
SKILL_PATH = _PLANNER_DIR / "SKILL.md"
BASELINE_PATH = _PLANNER_DIR / "SKILL.baseline.md"
HISTORY_DIR = _PLANNER_DIR / "history"

_START = "<!-- coverage:start -->"
_END = "<!-- coverage:end -->"
# Capture everything between the two markers (the body of the coverage block).
_BLOCK_RE = re.compile(
    re.escape(_START) + r"(?P<body>.*?)" + re.escape(_END),
    re.DOTALL,
)


def canonical_title(category: str) -> str:
    """Return the canonical bead title for a capability tag."""
    return CANONICAL_TITLE.get(category, category)


def read_skill(path: Path = SKILL_PATH) -> str:
    """Return the current planner skill text."""
    return Path(path).read_text(encoding="utf-8")


def write_skill(text: str, path: Path = SKILL_PATH) -> None:
    """Write the planner skill text to disk (creating parents if needed)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def parse_coverage(text: str) -> list[str]:
    """Parse the coverage block out of skill text into an ordered category list.

    Deterministic: reads only the fenced ``coverage`` block, one category per
    line, ignoring blank lines, list bullets, backticks, and inline comments.
    Entries are validated against the 7 scoring categories, deduped (first
    occurrence wins), and returned in CATEGORY_ORDER so callers get a canonical
    ordering regardless of how the block was written. Raises ValueError if the
    block markers are missing or the block contains no valid category, so a
    corrupted rewrite is caught rather than silently emptying the plan.
    """
    m = _BLOCK_RE.search(text)
    if m is None:
        raise ValueError(
            "coverage block not found (need "
            f"{_START!r} .. {_END!r} markers in SKILL.md)"
        )
    seen: set[str] = set()
    for raw_line in m.group("body").splitlines():
        line = raw_line.strip().strip("-*").strip().strip("`").strip()
        if not line or line.startswith("#") or line.startswith("<!--"):
            continue
        # Allow "category  # note" style; take the first token only.
        token = line.split()[0].strip().strip("`").strip().lower()
        if token in _VALID:
            seen.add(token)
    if not seen:
        raise ValueError("coverage block parsed to zero valid categories")
    return [c for c in CATEGORY_ORDER if c in seen]


def covered_categories(path: Path = SKILL_PATH) -> list[str]:
    """Read the skill at ``path`` and return its covered categories (ordered)."""
    return parse_coverage(read_skill(path))


def _render_block(categories: Iterable[str]) -> str:
    """Render the coverage block body (markers + one category per line)."""
    ordered = [c for c in CATEGORY_ORDER if c in set(categories)]
    body = "\n".join(ordered)
    return f"{_START}\n{body}\n{_END}"


def set_coverage(text: str, categories: Iterable[str]) -> str:
    """Return ``text`` with its coverage block replaced by ``categories``.

    Categories are filtered to the valid scoring set and re-ordered by
    CATEGORY_ORDER, so the written block is always canonical. Raises ValueError
    if ``text`` has no coverage block to replace.
    """
    if _BLOCK_RE.search(text) is None:
        raise ValueError("cannot set coverage: no coverage block in text")
    valid = [c for c in CATEGORY_ORDER if c in set(categories)]
    if not valid:
        raise ValueError("refusing to write an empty coverage block")
    return _BLOCK_RE.sub(lambda _m: _render_block(valid), text, count=1)


def add_category(text: str, category: str) -> str:
    """Return ``text`` with ``category`` added to the coverage block.

    No-op (returns text unchanged) if the category is already covered. Raises
    ValueError for an unknown category.
    """
    if category not in _VALID:
        raise ValueError(f"unknown category {category!r} (valid: {sorted(_VALID)})")
    current = parse_coverage(text)
    if category in current:
        return text
    return set_coverage(text, [*current, category])


def next_missing_category(
    covered: Iterable[str],
    failed_categories: Optional[Iterable[str]] = None,
) -> Optional[str]:
    """Pick the highest-impact category to add next.

    Prefers a category that is BOTH missing from ``covered`` and present in
    ``failed_categories`` (the validator's Weave-graded failures), choosing the
    lowest-index one by CATEGORY_ORDER. Falls back to the lowest-index missing
    category overall. Returns None when nothing is missing (full coverage).
    """
    have = set(covered)
    missing = [c for c in CATEGORY_ORDER if c not in have]
    if not missing:
        return None
    if failed_categories:
        failing = {c for c in failed_categories if c in _VALID}
        ranked = [c for c in missing if c in failing]
        if ranked:
            return ranked[0]
    return missing[0]


def reset_to_baseline() -> str:
    """Copy SKILL.baseline.md over SKILL.md and return the live text.

    This is how the self-improvement loop guarantees it always starts from the
    intentionally-incomplete v1 skill, even if a previous run left the live
    SKILL.md fully covered. Validates that the baseline has a parseable coverage
    block before clobbering the live file.
    """
    baseline_text = read_skill(BASELINE_PATH)
    parse_coverage(baseline_text)  # validate before we clobber the live file
    write_skill(baseline_text, SKILL_PATH)
    return baseline_text


def snapshot(version: int, text: Optional[str] = None) -> Path:
    """Write the current (or given) skill text to history/v{version}.md.

    Returns the snapshot path. Used by the loop to record the skill at each
    version so the board and the verifier can show the coverage block grow.
    """
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    if text is None:
        text = read_skill()
    path = HISTORY_DIR / f"v{int(version)}.md"
    path.write_text(text, encoding="utf-8")
    return path


def history() -> list[dict]:
    """Return [{version, path, covered}] for every history/v{n}.md, ascending.

    Each entry's ``covered`` is parsed from that snapshot's coverage block so a
    caller (the server's GET /skill, the verifier) can show how coverage grew.
    Snapshots whose coverage block fails to parse are skipped, not raised.
    """
    if not HISTORY_DIR.is_dir():
        return []
    out: list[dict] = []
    for p in HISTORY_DIR.glob("v*.md"):
        m = re.fullmatch(r"v(\d+)\.md", p.name)
        if not m:
            continue
        try:
            covered = parse_coverage(p.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        out.append({"version": int(m.group(1)), "path": str(p), "covered": covered})
    out.sort(key=lambda e: e["version"])
    return out
