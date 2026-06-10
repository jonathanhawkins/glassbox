"""The perf take-home task: optimize Anthropic's kernel for the fewest cycles.

A THIRD task the same swarm runs, and the first bring-your-own-repo one: the
workspace is Anthropic's published performance take-home (``perf-takehome/``), the
worker edits ``perf_takehome.py`` with the LLM only (no deterministic fallback), and
the evaluator runs the take-home's own grader (``tests/submission_tests.py``,
read-only) to read the simulated clock-cycle count. The score is a higher-is-better
normalized speedup so the BYO re-attempt loop, the leaderboard, and Weave are
unchanged; the raw cycle count rides in the event payload for the cockpit gauge.

Groups are the published cycle milestones (m18532 .. m1363): a milestone passes once
the kernel beats that bar, which is the signal the BYO loop re-attempts on. Progress
is genuine: each round the worker edits the real kernel and keeps the edit only if
the real grader reports fewer cycles AND the tests/ folder is byte-for-byte
untouched (the anti-gaming guard the take-home demands).
"""
from __future__ import annotations

import shutil
from pathlib import Path

from agents.skill import SkillConfig
from harness.evaluator import PerfTakehomeEvaluator

from ..base import Task

_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parents[1]
WORKSPACE = ROOT / "perf-takehome"
BASELINE_KERNEL = _HERE / "baseline" / "perf_takehome.py"
SKILL_DIR = _HERE / "skill"

EDIT_TARGET = "perf_takehome.py"

MILESTONES = PerfTakehomeEvaluator.MILESTONES  # (18532, 2164, 1790, 1487, 1363)
GROUPS = [PerfTakehomeEvaluator.cap_for(m) for m in MILESTONES]
FOUNDATIONAL = GROUPS[0]  # m18532, the easiest bar
STRUCTURAL = "verify"

GOAL = (
    "Optimize KernelBuilder.build_kernel in perf_takehome.py to run in as few "
    "simulated clock cycles as possible, keeping the output identical to the "
    "reference. The simulated machine is defined in problem.py (shown for reference, "
    "do not edit it): a VLIW machine with multiple engines and several slots per "
    "bundle (SLOT_LIMITS), vector lanes (VLEN), and N_CORES cores. Pack independent "
    "operations into the same bundle, vectorize across the batch, spread work over the "
    "cores, and remove redundant address math and loads. The baseline is 147734 "
    "cycles; each milestone is a lower cycle bar to beat. Do not edit anything under "
    "tests/."
)

TITLES = {
    "m18532": "Beat the updated starting point (under 18532 cycles)",
    "m2164": "Beat Claude Opus 4 (under 2164 cycles)",
    "m1790": "Beat Opus 4.5 casual (under 1790 cycles)",
    "m1487": "Beat Opus 4.5 at 11.5h (under 1487 cycles)",
    "m1363": "Beat the best published run (under 1363 cycles)",
    STRUCTURAL: "Verify the optimized kernel still matches the reference",
}

PERF_SKILL = SkillConfig(
    order=GROUPS,
    foundational=FOUNDATIONAL,
    structural=STRUCTURAL,
    titles=TITLES,
    skill_path=SKILL_DIR / "SKILL.md",
    baseline_path=SKILL_DIR / "SKILL.baseline.md",
    history_dir=SKILL_DIR / "history",
    unit="milestone",
)


def _reset() -> None:
    """Restore the pristine baseline kernel so each climb starts near 147734 cycles."""
    shutil.copyfile(BASELINE_KERNEL, WORKSPACE / EDIT_TARGET)


def build_task() -> Task:
    """Build the configured perf take-home Task (bring-your-own-repo)."""
    return Task(
        name="perf_takehome",
        goal=GOAL,
        workspace=WORKSPACE,
        evaluator=PerfTakehomeEvaluator(),
        # problem.py rides in edit_targets so the worker shows it to the model as
        # read-only ISA reference; it is NOT in edit_globs, so writes to it are blocked.
        edit_targets=[EDIT_TARGET, "problem.py"],
        build_cmd=None,  # pure Python, no build step
        build_cwd=WORKSPACE,
        groups=GROUPS,
        kind="byo",
        edit_globs=[EDIT_TARGET],
        test_paths=["tests/"],
        skill=PERF_SKILL,
        reset_fn=_reset,
        history_dir=_HERE / "history",
    )
