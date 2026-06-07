"""Task registry: ``load_task(name)`` returns a configured Task.

Imports are lazy (per task) so loading the tokenizer task does not pull in the
textkit task's pytest dependency, and vice versa.
"""
from __future__ import annotations

from .base import Task

DEFAULT_TASK = "tokenizer"


def available_tasks() -> list[str]:
    """The task names load_task understands."""
    return ["tokenizer", "textkit"]


def load_task(name: str | None = None) -> Task:
    """Build and return the Task for ``name`` (default: tokenizer)."""
    key = (name or DEFAULT_TASK).strip().lower()
    if key == "tokenizer":
        from .tokenizer import build_task

        return build_task()
    if key == "textkit":
        from .textkit import build_task

        return build_task()
    raise ValueError(f"unknown task {name!r} (available: {available_tasks()})")


__all__ = ["Task", "load_task", "available_tasks", "DEFAULT_TASK"]
