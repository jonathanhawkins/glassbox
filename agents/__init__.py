"""Glassbox agents core.

The self-improving swarm that ports a BPE tokenizer to Rust:

  - bus          Redis event bus (glassbox:events) + planner leaderboard.
  - beads        subprocess wrappers over the `br` CLI (the bead graph).
  - llm          OpenAI-compatible client for W&B Inference (Weave traced).
  - planner      decomposes the goal into the 8-bead capability graph.
  - coordinator  routes ready beads to workers (skeleton).
  - worker       implements a bead by adding its capability (skeleton).
  - validator    runs the oracle over accumulated capabilities (skeleton).
  - improver     rewrites planner/SKILL.md from Weave evals (skeleton).

Importing this package puts the repo root on sys.path so `contract.events`
resolves from anywhere.
"""
from __future__ import annotations

from . import _paths  # noqa: F401  (side effect: sys.path + .env)

__all__ = ["_paths"]
