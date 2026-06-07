"""The planner SKILL as the source of truth for which groups the plan covers.

A planner skill file carries a machine-readable coverage block delimited by
``<!-- coverage:start -->`` and ``<!-- coverage:end -->``, one group per line. This
module parses that block deterministically (never via the LLM) and rewrites it when
the improver adds a group, so the skill file is the genuine lever the
self-improvement loop pulls: planner.plan reads the covered set to decide which
beads to emit, and improver.improve grows the set based on the real evaluator
failures.

It is TASK-AGNOSTIC: every operation takes a ``SkillConfig`` (the ordered groups,
the foundational and structural tags, the per-group bead titles, and the skill /
baseline / history paths). The tokenizer's config is the module default
``TOKENIZER`` so existing no-arg callers keep working; a second task (e.g. the
pytest textkit) passes its own SkillConfig, and the SAME planner/improver/skill code
drives it.

Public interface (planner, improver, run, server call these, all cfg-parameterized
defaulting to the tokenizer):
    parse_coverage(text, cfg) -> list[str]       ordered, deduped, valid only
    covered_categories(cfg) -> list[str]
    set_coverage(text, groups, cfg) -> str
    add_category(text, group, cfg) -> str
    next_gap_by_impact(covered, failing, cfg) -> str | None
    next_missing_category(covered, failed, cfg) -> str | None
    reset_to_baseline(cfg) -> str
    reset_history(cfg) -> int
    snapshot(version, text, cfg) -> Path
    history(cfg) -> list[dict]
    canonical_title(group, cfg) -> str
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

_PLANNER_DIR = Path(__file__).resolve().parent / "planner"

# ----- tokenizer skill config (the module default, for back-compat) -----

# The canonical category order the planner/improver/validator agree on for the
# tokenizer task. Mirrors contract/CAPABILITIES.md. ascii is foundational.
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

# Canonical bead title per group. Kept in sync with SKILL.md so the deterministic
# plan and the LLM plan use the same titles (deps wire by title). The category
# beads are the IMPROVER's accuracy-bearing additions: each makes one input class
# pass exact-match by growing the regex pre-tokenization (they hang off the
# functional scaffold's regex bead, see TOKENIZER_SCAFFOLD).
CANONICAL_TITLE: dict[str, str] = {
    "ascii": "Cover plain ASCII text",
    "punctuation": "Cover punctuation and contractions",
    "numbers": "Cover numeric tokens",
    "code": "Cover source-code tokens",
    "unicode": "Cover unicode text",
    "whitespace": "Cover whitespace and spacing",
    "emoji": "Cover emoji and multibyte sequences",
    "harness": "Oracle diff harness and test runner",
}

# The PRD's functional decomposition (docs/prds/GLASSBOX_PRD.md section 4): the
# eight tokenizer COMPONENTS the planner emits as the v1 plan. These are STRUCTURAL
# scaffold (their tags are not scoring groups, so the worker wires them and the
# oracle does not key accuracy off them); the climbing curve is driven by the
# category coverage block, which the improver grows. Each entry is
# {tag, title, deps} where deps reference other scaffold tags. The dependency
# shape mirrors the PRD: byte_encoding / regex_pretok / harness are independent
# (parallel immediately), bpe_merge and special_tokens depend on vocab, and encode
# joins vocab..special_tokens.
TOKENIZER_SCAFFOLD: list[dict] = [
    {"tag": "vocab", "title": "Load vocab and BPE merge ranks", "deps": []},
    {"tag": "byte_encoding", "title": "Byte-level encoding (GPT-2 byte to unicode)", "deps": []},
    {"tag": "regex_pretok", "title": "Regex pre-tokenization (the gpt2 split pattern)", "deps": []},
    {"tag": "bpe_merge", "title": "BPE merge loop (rank-based pair merging)", "deps": ["vocab"]},
    {"tag": "special_tokens", "title": "Special-token handling", "deps": ["vocab"]},
    {"tag": "encode", "title": "Encode end to end",
     "deps": ["vocab", "byte_encoding", "regex_pretok", "bpe_merge", "special_tokens"]},
    {"tag": "decode", "title": "Decode end to end", "deps": ["vocab", "byte_encoding"]},
    {"tag": "harness", "title": "Oracle diff harness and test runner", "deps": []},
]

# Category beads (the improver's additions) hang off this scaffold component: each
# input class is delivered by growing the regex pre-tokenization branches.
TOKENIZER_SCAFFOLD_ANCHOR = "regex_pretok"

# Human-facing titles for the scaffold tags (used by canonical_title so deps wire
# by title for the scaffold beads too).
SCAFFOLD_TITLE: dict[str, str] = {s["tag"]: s["title"] for s in TOKENIZER_SCAFFOLD}

SKILL_PATH = _PLANNER_DIR / "SKILL.md"
BASELINE_PATH = _PLANNER_DIR / "SKILL.baseline.md"
HISTORY_DIR = _PLANNER_DIR / "history"

# The coverage block markers are shared across all tasks (one skill format).
_START = "<!-- coverage:start -->"
_END = "<!-- coverage:end -->"
_BLOCK_RE = re.compile(
    re.escape(_START) + r"(?P<body>.*?)" + re.escape(_END),
    re.DOTALL,
)


@dataclass
class SkillConfig:
    """Everything a task's planner skill needs to be parsed, grown, and snapshotted.

    ``order`` is the ordered list of scoring groups (tokenizer categories, or pytest
    test modules); ``foundational`` is the always-present base group; ``structural``
    is the non-scoring join tag (e.g. harness); ``titles`` maps a group to its bead
    title; the paths point at the live skill, the incomplete baseline, and the
    history dir.
    """

    order: list[str]
    foundational: str
    structural: str
    titles: dict[str, str]
    skill_path: Path
    baseline_path: Path
    history_dir: Path
    # What one group IS, for human-facing prose (the improver rationale, mail). The
    # tokenizer's groups are input "categories"; the textkit's are test "modules".
    unit: str = "category"
    # The PRD functional decomposition the planner emits as the v1 plan: a list of
    # {tag, title, deps} structural component beads. Empty means "no scaffold" (the
    # legacy foundational + categories + structural plan, used by textkit).
    scaffold: list[dict] = field(default_factory=list)
    # The scaffold tag the accuracy-bearing category beads depend on (e.g. the
    # regex pre-tokenization component for the tokenizer). None when no scaffold.
    scaffold_anchor: Optional[str] = None

    def valid(self) -> set[str]:
        """The set of valid scoring groups (the coverage block entries)."""
        return set(self.order)

    def scaffold_tags(self) -> set[str]:
        """The structural tags introduced by the functional scaffold (if any)."""
        return {s["tag"] for s in self.scaffold}

    def scaffold_titles(self) -> dict[str, str]:
        """Map each scaffold tag to its canonical bead title."""
        return {s["tag"]: s["title"] for s in self.scaffold}


# The default config: the tokenizer task. No-arg callers (server, legacy) get this.
TOKENIZER = SkillConfig(
    order=CATEGORY_ORDER,
    foundational=FOUNDATIONAL,
    structural=STRUCTURAL,
    titles={**CANONICAL_TITLE, **SCAFFOLD_TITLE},
    skill_path=SKILL_PATH,
    baseline_path=BASELINE_PATH,
    history_dir=HISTORY_DIR,
    scaffold=TOKENIZER_SCAFFOLD,
    scaffold_anchor=TOKENIZER_SCAFFOLD_ANCHOR,
)


def canonical_title(group: str, cfg: SkillConfig = TOKENIZER) -> str:
    """Return the canonical bead title for a group or scaffold tag."""
    return cfg.titles.get(group, group)


def read_skill(path: Path = SKILL_PATH) -> str:
    """Return the planner skill text at ``path``."""
    return Path(path).read_text(encoding="utf-8")


def write_skill(text: str, path: Path = SKILL_PATH) -> None:
    """Write the planner skill text to ``path`` (creating parents if needed)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def parse_coverage(text: str, cfg: SkillConfig = TOKENIZER) -> list[str]:
    """Parse the coverage block out of skill text into an ordered group list.

    Deterministic: reads only the fenced ``coverage`` block, one group per line,
    ignoring blank lines, list bullets, backticks, and inline comments. Entries are
    validated against ``cfg.order``, deduped (first occurrence wins), and returned in
    ``cfg.order`` so callers get a canonical ordering. Raises ValueError if the block
    markers are missing or no valid group is present, so a corrupted rewrite is
    caught rather than silently emptying the plan.
    """
    valid = cfg.valid()
    m = _BLOCK_RE.search(text)
    if m is None:
        raise ValueError(
            "coverage block not found (need "
            f"{_START!r} .. {_END!r} markers in the skill file)"
        )
    seen: set[str] = set()
    for raw_line in m.group("body").splitlines():
        line = raw_line.strip().strip("-*").strip().strip("`").strip()
        if not line or line.startswith("#") or line.startswith("<!--"):
            continue
        # Allow "group  # note" style; take the first token only.
        token = line.split()[0].strip().strip("`").strip().lower()
        if token in valid:
            seen.add(token)
    if not seen:
        raise ValueError("coverage block parsed to zero valid groups")
    return [c for c in cfg.order if c in seen]


def covered_categories(cfg: SkillConfig = TOKENIZER) -> list[str]:
    """Read the skill at ``cfg.skill_path`` and return its covered groups (ordered)."""
    return parse_coverage(read_skill(cfg.skill_path), cfg)


def _render_block(groups: Iterable[str], cfg: SkillConfig) -> str:
    """Render the coverage block body (markers + one group per line, ordered)."""
    ordered = [c for c in cfg.order if c in set(groups)]
    body = "\n".join(ordered)
    return f"{_START}\n{body}\n{_END}"


def set_coverage(
    text: str, groups: Iterable[str], cfg: SkillConfig = TOKENIZER
) -> str:
    """Return ``text`` with its coverage block replaced by ``groups``.

    Groups are filtered to ``cfg.order`` and re-ordered, so the written block is
    always canonical. Raises ValueError if ``text`` has no coverage block to replace.
    """
    if _BLOCK_RE.search(text) is None:
        raise ValueError("cannot set coverage: no coverage block in text")
    valid = [c for c in cfg.order if c in set(groups)]
    if not valid:
        raise ValueError("refusing to write an empty coverage block")
    return _BLOCK_RE.sub(lambda _m: _render_block(valid, cfg), text, count=1)


def add_category(text: str, group: str, cfg: SkillConfig = TOKENIZER) -> str:
    """Return ``text`` with ``group`` added to the coverage block.

    No-op (returns text unchanged) if already covered. Raises ValueError for an
    unknown group.
    """
    if group not in cfg.valid():
        raise ValueError(f"unknown group {group!r} (valid: {sorted(cfg.valid())})")
    current = parse_coverage(text, cfg)
    if group in current:
        return text
    return set_coverage(text, [*current, group], cfg)


def next_missing_category(
    covered: Iterable[str],
    failed_categories: Optional[Iterable[str]] = None,
    cfg: SkillConfig = TOKENIZER,
) -> Optional[str]:
    """Pick the next group to add: lowest-index missing, preferring a failing one.

    Prefers a group BOTH missing from ``covered`` and present in
    ``failed_categories`` (the validator's failures), choosing the lowest-index by
    ``cfg.order``. Falls back to the lowest-index missing group. Returns None at full
    coverage.
    """
    have = set(covered)
    missing = [c for c in cfg.order if c not in have]
    if not missing:
        return None
    if failed_categories:
        failing = {c for c in failed_categories if c in cfg.valid()}
        ranked = [c for c in missing if c in failing]
        if ranked:
            return ranked[0]
    return missing[0]


def next_gap_by_impact(
    covered: Iterable[str],
    failing: Optional[Iterable[dict]] = None,
    cfg: SkillConfig = TOKENIZER,
) -> Optional[str]:
    """Pick the missing group with the MOST failing items (the biggest gap).

    ``failing`` is the validator's per-group breakdown (dicts with ``category`` and
    ``failed``). Among groups missing from ``covered``, returns the one with the
    highest ``failed`` count, breaking ties by ``cfg.order``. Falls back to
    ``next_missing_category`` when no magnitudes are available, so the loop always
    progresses. This is what makes the climb data-driven.
    """
    have = set(covered)
    missing = [c for c in cfg.order if c not in have]
    if not missing:
        return None
    valid = cfg.valid()
    counts: dict[str, int] = {}
    for f in failing or []:
        if not isinstance(f, dict):
            continue
        cat = f.get("category")
        if isinstance(cat, str) and cat in valid:
            counts[cat] = int(f.get("failed", 0) or 0)
    ranked = [c for c in missing if counts.get(c, 0) > 0]
    if not ranked:
        return next_missing_category(covered, cfg=cfg)
    ranked.sort(key=lambda c: (-counts.get(c, 0), cfg.order.index(c)))
    return ranked[0]


def reset_to_baseline(cfg: SkillConfig = TOKENIZER) -> str:
    """Copy the baseline skill over the live skill and return the live text.

    How the loop guarantees it always starts from the intentionally-incomplete v1
    skill. Validates the baseline has a parseable coverage block before clobbering.
    """
    baseline_text = read_skill(cfg.baseline_path)
    parse_coverage(baseline_text, cfg)  # validate before we clobber the live file
    write_skill(baseline_text, cfg.skill_path)
    return baseline_text


def reset_history(cfg: SkillConfig = TOKENIZER) -> int:
    """Delete every history/v*.md snapshot for this skill. Returns how many removed.

    Used by Reset so the planner skill genuinely starts over (only the next
    snapshot, typically v1 of the baseline, remains).
    """
    if not cfg.history_dir.is_dir():
        return 0
    removed = 0
    for p in cfg.history_dir.glob("v*.md"):
        if re.fullmatch(r"v(\d+)\.md", p.name):
            try:
                p.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def snapshot(
    version: int, text: Optional[str] = None, cfg: SkillConfig = TOKENIZER
) -> Path:
    """Write the current (or given) skill text to the config's history/v{version}.md."""
    cfg.history_dir.mkdir(parents=True, exist_ok=True)
    if text is None:
        text = read_skill(cfg.skill_path)
    path = cfg.history_dir / f"v{int(version)}.md"
    path.write_text(text, encoding="utf-8")
    return path


def history(cfg: SkillConfig = TOKENIZER) -> list[dict]:
    """Return [{version, path, covered}] for every history/v{n}.md, ascending.

    Each entry's ``covered`` is parsed from that snapshot so a caller (GET /skill,
    the verifier) can show how coverage grew. Unparseable snapshots are skipped.
    """
    if not cfg.history_dir.is_dir():
        return []
    out: list[dict] = []
    for p in cfg.history_dir.glob("v*.md"):
        m = re.fullmatch(r"v(\d+)\.md", p.name)
        if not m:
            continue
        try:
            covered = parse_coverage(p.read_text(encoding="utf-8"), cfg)
        except (ValueError, OSError):
            continue
        out.append({"version": int(m.group(1)), "path": str(p), "covered": covered})
    out.sort(key=lambda e: e["version"])
    return out
