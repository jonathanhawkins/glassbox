"""The bring-your-own-repo (BYO) task: point the SAME swarm at a real repo and
watch it genuinely make the failing tests pass, with NO deterministic safety net.

Unlike the curated tasks (tokenizer, textkit), a BYO task ships no reference
solution. The operator supplies a repo (path or git URL), a test command (pytest
for the demo), the files the workers may edit, and a goal. ``build_task(cfg)``:

  1. Materializes a DISPOSABLE sandbox clone of the repo (the user's repo is never
     mutated; cleanup is an rmtree).
  2. Runs the test suite ONCE to DISCOVER the scoring groups: the test modules that
     currently have failures become ``Task.groups`` (dynamic, not a constant).
  3. Synthesizes a conformant SkillConfig + SKILL.md whose coverage block lists all
     discovered groups, so ``planner.plan`` runs UNCHANGED (one bead per failing
     module) and the curated planner/coordinator/validator need no edits.

The Task sets ``kind="byo"`` and leaves ``apply_groups_fn``/``reset_fn``/
``restore_fn`` as None: the worker's BYO branch authors real edits with the LLM and
keeps an edit only if it strictly raises the score (else the bead bounces, score
flat). The honesty story: every point the curve moves is a test the model actually
made pass.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from agents.skill import SkillConfig
from harness.evaluator import PytestEvaluator

from ..base import Task

_HERE = Path(__file__).resolve().parent
FIXTURES = _HERE / "_fixtures"
SANDBOXES = _HERE / "_sandboxes"
STATE = _HERE / "_state"  # synthesized skill files, per task id

# Dirs never copied into a sandbox (huge/regenerable; pollute a clean clone).
_SKIP_DIRS = {".git", "node_modules", "target", "__pycache__", ".venv", ".pytest_cache"}

# Coverage block markers (shared skill format across all tasks).
_COV_START = "<!-- coverage:start -->"
_COV_END = "<!-- coverage:end -->"


def _resolve_repo(repo: str) -> tuple[str, Optional[Path]]:
    """Classify the repo arg as ('url', None) or ('path', resolved_local_path).

    A vetted fixture name (no slash, exists under _fixtures) resolves to the bundled
    repo so the default demo path needs no network.
    """
    cand = FIXTURES / repo
    if cand.exists():
        return "path", cand.resolve()
    p = Path(repo).expanduser()
    if p.exists():
        return "path", p.resolve()
    return "url", None


def _materialize_sandbox(repo: str, task_id: str) -> Path:
    """Copy/clone ``repo`` into a fresh disposable sandbox dir; return its path.

    A throwaway clone (not a git worktree) so a botched edit/build never touches the
    operator's repo and cleanup is a single rmtree.
    """
    SANDBOXES.mkdir(parents=True, exist_ok=True)
    dest = SANDBOXES / task_id
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    kind, local = _resolve_repo(repo)
    if kind == "url":
        subprocess.run(
            ["git", "clone", "--depth", "1", repo, str(dest)],
            check=True,
            capture_output=True,
            text=True,
            timeout=180,
        )
    else:
        assert local is not None
        if (local / ".git").exists():
            subprocess.run(
                ["git", "clone", str(local), str(dest)],
                check=True,
                capture_output=True,
                text=True,
                timeout=180,
            )
        else:
            shutil.copytree(
                local,
                dest,
                ignore=shutil.ignore_patterns(*_SKIP_DIRS),
            )
    return dest


def _failing_groups(result: Any) -> list[str]:
    """The test-module groups with at least one failure in the initial eval."""
    by_group = getattr(result, "by_group", {}) or {}
    return sorted(g for g, v in by_group.items() if int(v.get("failed", 0)) > 0)


def _write_skill(cfg_dir: Path, groups: list[str]) -> Path:
    """Write a SKILL.md whose coverage block lists every discovered group."""
    cfg_dir.mkdir(parents=True, exist_ok=True)
    path = cfg_dir / "SKILL.md"
    lines = [
        "# BYO planner skill",
        "",
        "Plan one bead per failing test module discovered from the first eval.",
        "",
        _COV_START,
    ]
    lines += [f"- {g}" for g in groups]
    lines += [_COV_END, ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _byo_skill(task_id: str, groups: list[str]) -> SkillConfig:
    """Synthesize a conformant SkillConfig so planner.plan runs unchanged."""
    cfg_dir = STATE / task_id
    skill_path = _write_skill(cfg_dir, groups)
    # baseline mirrors the live skill (BYO never resets the skill); history for snapshots.
    baseline_path = cfg_dir / "SKILL.baseline.md"
    shutil.copyfile(skill_path, baseline_path)
    titles = {g: f"Make the {g} tests pass" for g in groups}
    titles["suite"] = "Wire up and run the suite"
    foundational = groups[0] if groups else "setup"
    return SkillConfig(
        order=list(groups),
        foundational=foundational,
        structural="suite",
        titles=titles,
        skill_path=skill_path,
        baseline_path=baseline_path,
        history_dir=cfg_dir / "history",
        unit="module",
    )


def build_task(cfg: dict) -> Task:
    """Build a BYO Task from operator config.

    cfg keys: id, repo, goal, test_args (list), edit (globs), tests (read-only dirs),
    label. Only pytest is supported for the demo.
    """
    task_id = str(cfg["id"])
    repo = str(cfg["repo"])
    workspace = _materialize_sandbox(repo, task_id)

    test_args = cfg.get("test_args") or ["-q"]
    evaluator = PytestEvaluator(test_args=list(test_args))

    # Discover the scoring groups by running the suite once.
    initial = evaluator.evaluate(workspace)
    groups = _failing_groups(initial)

    edit_globs = cfg.get("edit") or ["**/*.py"]
    test_paths = cfg.get("tests") or ["tests", "test"]
    goal = cfg.get("goal") or "Make the failing tests pass."

    return Task(
        name=task_id,
        goal=goal,
        workspace=workspace,
        evaluator=evaluator,
        # The concrete files the workers edit are resolved per bead from edit_globs;
        # edit_targets seeds the code viewer with files that already exist + match.
        edit_targets=_seed_edit_targets(workspace, edit_globs, test_paths),
        build_cmd=None,  # pytest needs no separate build
        build_cwd=workspace,
        groups=groups,
        skill=_byo_skill(task_id, groups),
        kind="byo",
        edit_globs=list(edit_globs),
        test_paths=list(test_paths),
        history_dir=STATE / task_id / "workspace_history",
    )


def _seed_edit_targets(
    workspace: Path, edit_globs: list[str], test_paths: list[str]
) -> list[str]:
    """Workspace-relative files matching edit_globs and not under test_paths.

    Bounded so the code viewer has something to show without listing a huge repo.
    """
    out: list[str] = []
    test_prefixes = tuple(tp.rstrip("/") + "/" for tp in test_paths)
    for glob in edit_globs:
        for p in sorted(workspace.glob(glob)):
            if not p.is_file():
                continue
            rel = p.relative_to(workspace).as_posix()
            if rel.startswith(test_prefixes) or any(seg in _SKIP_DIRS for seg in rel.split("/")):
                continue
            if rel not in out:
                out.append(rel)
            if len(out) >= 25:
                return out
    return out
