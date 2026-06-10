"""The speedkit task: optimize a suite of naive hot functions for speed.

A bring-your-own-repo task the swarm can genuinely move: the worker rewrites the
naive functions in kernels.py with the LLM (numpy / better algorithms), and the
frozen grader (tests/grade.py, read-only) checks each function against a reference on
random inputs and measures its speedup. A function is "optimized" once it is correct
AND at least TARGET x faster, so the score is the fraction of the suite optimized and
the cockpit gauge shows the mean speedup climbing as beads close. Unlike the perf
take-home (which is deliberately AI-resistant), these functions are well within reach,
so the climb is a real, visible consequence of the code the agents wrote.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from agents.skill import SkillConfig
from harness.evaluator import SpeedupEvaluator

from ..base import Task

_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parents[1]
WORKSPACE = ROOT / "speedkit"
BASELINE_KERNELS = _HERE / "baseline" / "kernels.py"
SKILL_DIR = _HERE / "skill"

FUNCTIONS = ["matmul", "pairwise_sq_dists", "count_pairs_with_sum"]
FOUNDATIONAL = FUNCTIONS[0]
STRUCTURAL = "verify"

GOAL = (
    "Optimize the naive functions in kernels.py to run as fast as possible while "
    "keeping each function's output identical to the reference. You may use numpy or "
    "better algorithms. Each function is graded by correctness and measured speedup. "
    "Do not edit anything under tests/."
)

TITLES = {
    "matmul": "Speed up matmul",
    "pairwise_sq_dists": "Speed up pairwise squared distances",
    "count_pairs_with_sum": "Speed up pair-sum counting",
    STRUCTURAL: "Verify all kernels still match the reference",
}

SPEEDKIT_SKILL = SkillConfig(
    order=FUNCTIONS,
    foundational=FOUNDATIONAL,
    structural=STRUCTURAL,
    titles=TITLES,
    skill_path=SKILL_DIR / "SKILL.md",
    baseline_path=SKILL_DIR / "SKILL.baseline.md",
    history_dir=SKILL_DIR / "history",
    unit="function",
)


def _reset() -> None:
    """Restore the pristine naive kernels so each climb starts unoptimized."""
    shutil.copyfile(BASELINE_KERNELS, WORKSPACE / "kernels.py")


def build_task() -> Task:
    """Build the configured speedkit Task (bring-your-own-repo)."""
    return Task(
        name="speedkit",
        goal=GOAL,
        workspace=WORKSPACE,
        evaluator=SpeedupEvaluator(FUNCTIONS),
        edit_targets=["kernels.py"],
        build_cmd=None,  # pure Python, no build step
        build_cwd=WORKSPACE,
        groups=FUNCTIONS,
        kind="byo",
        edit_globs=["kernels.py"],
        test_paths=["tests/"],
        skill=SPEEDKIT_SKILL,
        reset_fn=_reset,
        history_dir=_HERE / "history",
    )
