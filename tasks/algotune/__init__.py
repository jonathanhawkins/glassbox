"""The AlgoTune task: beat real numpy/scipy reference solvers (NeurIPS 2025 benchmark).

A bring-your-own-repo task pointing at three real AlgoTune problems (Cholesky
factorization, matrix exponential, real symmetric eigenvalues). The worker edits
solver.py to make each solve_* beat its reference while staying valid; the frozen
grader (tests/grade.py, read-only, carrying AlgoTune's own generation + validation)
times the agent against the reference and reports the speedup. The optimize loop climbs
the mean speedup until it is genuinely stuck. Source: github.com/oripress/AlgoTune.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from agents.skill import SkillConfig
from harness.evaluator import SpeedupEvaluator

from ..base import Task

_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parents[1]
WORKSPACE = ROOT / "algotune"
BASELINE_SOLVER = _HERE / "baseline" / "solver.py"
SKILL_DIR = _HERE / "skill"

FUNCTIONS = ["cholesky", "matrix_exponential", "eigenvalues_real", "count_connected_components"]
FOUNDATIONAL = FUNCTIONS[0]
STRUCTURAL = "verify"

GOAL = (
    "Optimize solver.py so each solve_* function runs faster than its reference "
    "(numpy/scipy) while still passing the task's own validation. These are real "
    "AlgoTune benchmark problems, so beating a tuned library function is the win. For "
    "example, a reference that computes eigenvectors it then discards can be replaced "
    "by an eigenvalues-only routine. Do not edit anything under tests/."
)

TITLES = {
    "cholesky": "Beat the Cholesky reference",
    "matrix_exponential": "Beat the matrix-exponential reference",
    "eigenvalues_real": "Beat the real-eigenvalues reference",
    "count_connected_components": "Beat the connected-components reference",
    STRUCTURAL: "Verify all solvers still match the reference",
}

ALGOTUNE_SKILL = SkillConfig(
    order=FUNCTIONS,
    foundational=FOUNDATIONAL,
    structural=STRUCTURAL,
    titles=TITLES,
    skill_path=SKILL_DIR / "SKILL.md",
    baseline_path=SKILL_DIR / "SKILL.baseline.md",
    history_dir=SKILL_DIR / "history",
    unit="task",
)


def _reset() -> None:
    """Restore each solver to the reference, so a climb starts at 1.0x (no advantage)."""
    shutil.copyfile(BASELINE_SOLVER, WORKSPACE / "solver.py")


def build_task() -> Task:
    """Build the configured AlgoTune Task (bring-your-own-repo)."""
    return Task(
        name="algotune",
        goal=GOAL,
        workspace=WORKSPACE,
        evaluator=SpeedupEvaluator(FUNCTIONS, target=1.2, deps=("numpy", "scipy", "networkx")),
        edit_targets=["solver.py"],
        build_cmd=None,
        build_cwd=WORKSPACE,
        groups=FUNCTIONS,
        kind="byo",
        edit_globs=["solver.py"],
        test_paths=["tests/"],
        skill=ALGOTUNE_SKILL,
        reset_fn=_reset,
        history_dir=_HERE / "history",
    )
