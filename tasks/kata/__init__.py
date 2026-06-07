"""The kata task: implement the textkit string library so its pytest suite passes.

A second, deliberately-different task the SAME swarm runs, to prove generality: the
evaluator is pytest (not a token-id oracle), the workspace is a multi-module Python
package (not a single Rust file), and each group is a test module / function. The
planner / coordinator / worker / validator / improver are unchanged; only this task
package and its SkillConfig differ.

Groups map 1:1 to modules (slug, wrap, numbers, template; foundational: slug). The
workspace starts from a baseline (the foundational module implemented, the rest
stubbed); each covered group's module becomes the reference implementation. The
worker authors that module via the LLM with the reference copy as the deterministic
fallback, and pytest grades the real package, so the pass-rate climbs as a genuine
consequence of the code the agents wrote.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from agents.skill import SkillConfig
from harness.evaluator import PytestEvaluator

from ..base import Task

_HERE = Path(__file__).resolve().parent
WORKSPACE = _HERE / "workspace"
REFERENCE = _HERE / "reference"
STUBS = _HERE / "stubs"
SKILL_DIR = _HERE / "skill"

GROUPS = ["slug", "wrap", "numbers", "template"]
FOUNDATIONAL = "slug"
MODULE_FOR = {g: f"textkit/{g}.py" for g in GROUPS}

GOAL = (
    "Implement the textkit string library (slugify, wrap_words, comma, render) so "
    "its pytest suite passes. One bead per module; build the foundational module "
    "first, then cover the module whose tests fail most."
)

KATA_SKILL = SkillConfig(
    order=GROUPS,
    foundational=FOUNDATIONAL,
    structural="suite",
    titles={
        "slug": "Slugify strings",
        "wrap": "Word-wrap text to a width",
        "numbers": "Format integers with thousands commas",
        "template": "Render {var} templates",
        "suite": "Wire up the package and run the suite",
    },
    skill_path=SKILL_DIR / "SKILL.md",
    baseline_path=SKILL_DIR / "SKILL.baseline.md",
    history_dir=SKILL_DIR / "history",
)


def _install(group: str, source_root: Path) -> None:
    """Copy {source_root}/textkit/{group}.py over the live workspace module."""
    src = source_root / "textkit" / f"{group}.py"
    dst = WORKSPACE / "textkit" / f"{group}.py"
    if src.exists():
        shutil.copyfile(src, dst)


def _apply(groups: set[str]) -> None:
    """Genuinely satisfy exactly ``groups``: the reference module for each covered
    group (the foundational one is always covered), the stub module for the rest."""
    covered = set(groups) | {FOUNDATIONAL}
    for g in GROUPS:
        _install(g, REFERENCE if g in covered else STUBS)


def _reset() -> None:
    """Baseline: only the foundational module implemented, the rest stubbed."""
    _apply(set())


def _restore() -> None:
    """Restore the complete (green) workspace: every module is the reference."""
    _apply(set(GROUPS))


def build_task() -> Task:
    """Build the configured kata Task."""
    return Task(
        name="kata",
        goal=GOAL,
        workspace=WORKSPACE,
        evaluator=PytestEvaluator(),
        edit_targets=[MODULE_FOR[g] for g in GROUPS],
        group_targets=dict(MODULE_FOR),
        build_cmd=None,  # pure Python, no build step
        build_cwd=WORKSPACE,
        groups=GROUPS,
        skill=KATA_SKILL,
        reset_fn=_reset,
        apply_groups_fn=_apply,
        restore_fn=_restore,
        history_dir=_HERE / "history",
    )
