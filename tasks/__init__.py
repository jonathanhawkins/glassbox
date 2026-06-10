"""Task registry: ``load_task(name)`` returns a configured Task.

Imports are lazy (per task) so loading the tokenizer task does not pull in the
textkit task's pytest dependency, and vice versa. ``TASK_SPECS`` carries cheap
metadata (goal, unit, kind) that ``task_specs()`` exposes WITHOUT importing the
task module, so the cockpit's ``GET /tasks`` stays fast and cannot be taken down
by a task module's import-time failure.
"""
from __future__ import annotations

from .base import Task

DEFAULT_TASK = "speedkit"

# id -> static descriptor. ``module`` is imported lazily by load_task; everything
# else is returned by task_specs() as-is (no task import needed).
TASK_SPECS: dict[str, dict] = {
    "algotune": {
        "module": ".algotune",
        "kind": "byo",
        "goal": "beat real numpy/scipy reference solvers (AlgoTune benchmark)",
        "unit": "task",
    },
    "speedkit": {
        "module": ".speedkit",
        "kind": "byo",
        "goal": "optimize a suite of naive hot functions for speed",
        "unit": "function",
    },
    "perf_takehome": {
        "module": ".perf_takehome",
        "kind": "byo",
        "goal": "optimize Anthropic's kernel take-home for the fewest cycles",
        "unit": "milestone",
    },
    "tokenizer": {
        "module": ".tokenizer",
        "kind": "curated",
        "goal": "port the BPE tokenizer to Rust",
        "unit": "category",
    },
    "textkit": {
        "module": ".textkit",
        "kind": "curated",
        "goal": "build the textkit Python library",
        "unit": "module",
    },
}


def available_tasks() -> list[str]:
    """The task names load_task understands."""
    return list(TASK_SPECS)


def task_specs() -> list[dict]:
    """Cheap per-task metadata for the cockpit (no task module import)."""
    return [
        {"id": tid, **{k: v for k, v in spec.items() if k != "module"}}
        for tid, spec in TASK_SPECS.items()
    ]


def load_task(name: str | None = None) -> Task:
    """Build and return the Task for ``name`` (default: tokenizer)."""
    key = (name or DEFAULT_TASK).strip().lower()
    spec = TASK_SPECS.get(key)
    if spec is None:
        raise ValueError(f"unknown task {name!r} (available: {available_tasks()})")
    import importlib

    mod = importlib.import_module(spec["module"], __name__)
    return mod.build_task()


__all__ = [
    "Task",
    "load_task",
    "available_tasks",
    "task_specs",
    "TASK_SPECS",
    "DEFAULT_TASK",
]
