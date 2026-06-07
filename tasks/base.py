"""Task: a self-contained problem the swarm works on, behind one uniform shape.

A Task bundles everything the (task-agnostic) swarm needs to genuinely build and
grade real code for a problem:

  - ``goal``        the prompt the planner decomposes,
  - ``workspace``   the directory the workers edit (and the build runs in),
  - ``evaluator``   a checkable Evaluator (tests / reference diff) -> EvalResult,
  - ``edit_targets``the files workers may touch (for context + snapshots),
  - ``build``       compile/prepare the workspace (e.g. cargo build),
  - ``reset_workspace`` / ``apply_groups`` / ``snapshot_workspace`` the filesystem
    dance the self-improvement loop needs.

The tokenizer task drives ``reset_workspace``/``apply_groups`` from a deterministic
renderer (it rewrites src/pretok.rs for a set of covered groups); a future task can
instead copy reference files. Either way the oracle grades the real rebuilt
artifact, so the correctness curve is a genuine consequence of the source.

Loaded via ``tasks.load_task(name)``.
"""
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from agents.skill import SkillConfig
from harness.evaluator import EvalResult, Evaluator

ROOT = Path(__file__).resolve().parents[1]

# Build guard so a wedged compiler can never hang the loop.
BUILD_TIMEOUT_S = 300


@dataclass(repr=False)
class Task:
    """A problem the swarm builds and the evaluator grades. See module docstring."""

    name: str
    goal: str
    workspace: Path
    evaluator: Evaluator
    edit_targets: list[str] = field(default_factory=list)
    build_cmd: Optional[list[str]] = None
    build_cwd: Optional[Path] = None
    # Known group order for stable cockpit/improver ordering (input categories for
    # the tokenizer, test modules for pytest). Optional.
    groups: list[str] = field(default_factory=list)
    # The planner-skill config for this task (ordered groups, foundational and
    # structural tags, bead titles, and skill/baseline/history paths). The
    # planner/improver read it; defaults to the tokenizer skill when unset.
    skill: Optional[SkillConfig] = None
    # Deterministic source mutators (task-specific). reset_fn installs the
    # intentionally-incomplete baseline; apply_groups_fn renders/installs the source
    # that genuinely satisfies a SET of covered groups (idempotent in that set);
    # restore_fn (optional) returns the workspace to its complete green state (else
    # apply_groups over all groups is used).
    reset_fn: Optional[Callable[[], None]] = None
    apply_groups_fn: Optional[Callable[[set[str]], None]] = None
    restore_fn: Optional[Callable[[], None]] = None
    history_dir: Optional[Path] = None

    def __repr__(self) -> str:
        # Keep Weave op traces clean: a Task holds callables + an Evaluator, so the
        # default dataclass repr is noisy. Trace inputs read as Task(<name>).
        return f"Task({self.name})"

    # ----- workspace lifecycle -----

    def reset_workspace(self) -> None:
        """Reset the workspace to its intentionally-incomplete baseline."""
        if self.reset_fn is not None:
            self.reset_fn()

    def restore_workspace(self) -> None:
        """Restore the workspace to its complete (green) state for repo hygiene.

        A run leaves the workspace at whatever partial state it reached; this
        rewrites the complete source so the repo is green at rest (cargo test and
        the oracle pass). The genuine per-version results live in the leaderboard
        and the history snapshots, so restoring the live file loses nothing. Called
        in a finally after a top-level run and by /reset.
        """
        if self.restore_fn is not None:
            self.restore_fn()
        elif self.apply_groups_fn is not None and self.groups:
            self.apply_groups_fn(set(self.groups))
        # Rebuild so the artifact matches the restored (complete) source, not the
        # partial binary the run left behind.
        self.build()

    def apply_groups(self, groups) -> None:
        """Deterministically make the workspace genuinely satisfy ``groups``.

        Used as the Phase 1 worker action and the Phase 2 worker fallback: it edits
        real source (e.g. rewrites pretok.rs), so building + grading reflects a real
        code change, not a gate.
        """
        if self.apply_groups_fn is not None:
            self.apply_groups_fn(set(groups))

    def snapshot_workspace(self, version: int) -> Optional[Path]:
        """Copy the edit_targets into history/v{version}/ (mirroring rel paths)."""
        if not self.history_dir or not self.edit_targets:
            return None
        dest = self.history_dir / f"v{int(version)}"
        for rel in self.edit_targets:
            src = self.workspace / rel
            if not src.exists():
                continue
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out)
        return dest

    # ----- build + grade -----

    def build(self) -> tuple[bool, str]:
        """Build the workspace. Returns (ok, tail of stderr). No-op if no build."""
        if not self.build_cmd:
            return True, ""
        try:
            proc = subprocess.run(
                self.build_cmd,
                cwd=str(self.build_cwd or ROOT),
                capture_output=True,
                text=True,
                timeout=BUILD_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            return False, f"build timed out after {BUILD_TIMEOUT_S}s"
        except OSError as exc:
            return False, f"failed to run build: {exc}"
        ok = proc.returncode == 0
        return ok, (proc.stderr or "")[-4000:]

    def evaluate(self, *, seed: Optional[int] = None) -> EvalResult:
        """Grade the current workspace with the task's checkable evaluator."""
        return self.evaluator.evaluate(self.workspace, seed=seed)

    # ----- file access (for the worker's LLM context + edits) -----

    def read_target(self, rel: str) -> str:
        p = self.workspace / rel
        return p.read_text(encoding="utf-8") if p.exists() else ""

    def write_target(self, rel: str, text: str) -> None:
        p = self.workspace / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
