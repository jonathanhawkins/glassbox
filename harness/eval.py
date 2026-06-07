"""Standalone Weave Evaluation + Redis leaderboard for one planner version.

This is the CLI counterpart of ``agents.validator.validate``: it grades a task's
CURRENT workspace with the task's REAL checkable evaluator (the exact same evaluator
the live validator uses), logs a real ``weave.Evaluation`` for the planner version
via ``harness.weave_eval``, and mirrors the accuracy onto the per-task Redis
leaderboard. The live swarm logs the same Evaluation inline; this is for grading a
single version by hand (or from a script) without spinning the whole swarm.

General by construction: it loads any task via ``tasks.load_task`` and grades
whatever uniform ``EvalResult`` the evaluator returns (the tokenizer oracle diff,
the pytest runner, ...). It does NOT gate the artifact (no ``--caps`` to the binary):
accuracy is a genuine function of the workspace source the task currently holds.

CLI:
  uv run python -m harness.eval --task tokenizer --planner-version 1
  uv run python -m harness.eval --task textkit  --planner-version 3 --run-id demo
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

from harness import weave_eval  # noqa: E402


def _update_leaderboard(task_name: str, planner_version: int, accuracy: float) -> bool:
    """ZADD accuracy onto the per-task leaderboard sorted set. Best-effort.

    Uses the SAME per-task key as the live validator (contract.planner_scores_key),
    so a manual grade lands on the same curve. Returns False if Redis is unreachable.
    """
    try:
        import redis as redis_lib

        from contract.events import planner_scores_key

        url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
        r = redis_lib.from_url(url, decode_responses=True)
        r.zadd(planner_scores_key(task_name), {str(planner_version): float(accuracy)})
        return True
    except Exception as exc:  # noqa: BLE001 - Redis is best-effort here
        print(f"[redis] leaderboard update skipped: {exc}", file=sys.stderr)
        return False


def _emit_rewrite_event(
    task_name: str, run_id: str, planner_version: int, accuracy: float
) -> None:
    """Append a planner_rewrite event to glassbox:events (best-effort, opt-in)."""
    if not run_id:
        return
    try:
        import redis as redis_lib

        from contract.events import EVENTS_STREAM, make_event

        url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
        r = redis_lib.from_url(url, decode_responses=True)
        event = make_event(
            "planner_rewrite",
            run_id=run_id,
            planner_version=planner_version,
            agent="validator",
            title=f"planner v{planner_version} scored {accuracy:.3f}",
            payload={"accuracy": accuracy, "task": task_name},
        )
        r.xadd(EVENTS_STREAM, {"data": json.dumps(event)})
    except Exception as exc:  # noqa: BLE001
        print(f"[redis] event emit skipped: {exc}", file=sys.stderr)


def evaluate(
    planner_version: int,
    task_name: str = "tokenizer",
    run_id: str = "",
    emit_event: bool = False,
) -> dict:
    """Build + grade ``task_name`` with its real evaluator, log a Weave Evaluation,
    and ZADD the accuracy onto the Redis leaderboard.

    Returns a summary dict augmented with ``weave_logged``, ``weave_url``, and
    ``leaderboard_updated``.
    """
    load_dotenv(ROOT / ".env")

    from tasks import load_task

    task = load_task(task_name)

    build_ok, build_err = task.build()
    if build_ok:
        result = task.evaluate()
    else:
        from harness.evaluator import EvalResult

        result = EvalResult(
            score=0.0, passed=0, total=0, error=f"build failed: {build_err[:200]}"
        )

    accuracy = float(result.score)
    logged = weave_eval.log_planner_eval(task_name, planner_version, result)
    leaderboard_updated = _update_leaderboard(task_name, planner_version, accuracy)
    if emit_event and run_id:
        _emit_rewrite_event(task_name, run_id, planner_version, accuracy)

    return {
        "task": task_name,
        "planner_version": planner_version,
        "accuracy": accuracy,
        "passed": result.passed,
        "total": result.total,
        "pass_at_1": float(getattr(result, "pass_at_1", accuracy) or 0.0),
        "wall_ms": int(getattr(result, "wall_ms", 0) or 0),
        "by_group": result.by_group,
        "error": result.error,
        "weave_logged": bool(logged.get("logged")),
        "weave_url": logged.get("url"),
        "leaderboard_updated": leaderboard_updated,
        "run_id": run_id,
    }


def _main() -> None:
    ap = argparse.ArgumentParser(
        description=(
            "Grade a task with its checkable evaluator, log a real Weave Evaluation "
            "for the planner version, and update the per-task leaderboard."
        )
    )
    ap.add_argument("--task", default="tokenizer", help="task name (tokenizer, textkit)")
    ap.add_argument("--planner-version", type=int, required=True)
    ap.add_argument("--run-id", default="")
    ap.add_argument(
        "--emit-event",
        action="store_true",
        help="also append a planner_rewrite event to glassbox:events",
    )
    args = ap.parse_args()

    res = evaluate(
        planner_version=args.planner_version,
        task_name=args.task,
        run_id=args.run_id,
        emit_event=args.emit_event,
    )

    print("=" * 60)
    print(f"task            : {res['task']}")
    print(f"planner_version : {res['planner_version']}")
    print(f"accuracy        : {res['accuracy']:.4f}  ({res['passed']}/{res['total']})")
    print(f"pass_at_1       : {res['pass_at_1']:.4f}")
    print(f"wall_ms         : {res['wall_ms']}")
    print(f"weave           : {'logged' if res['weave_logged'] else 'SKIPPED'}")
    print(f"leaderboard     : {'updated' if res['leaderboard_updated'] else 'SKIPPED'}")
    if res["weave_url"]:
        print(f"weave_url       : {res['weave_url']}")
    if res["error"]:
        print(f"note            : {res['error']}")
    print("=" * 60)
    print(json.dumps({k: v for k, v in res.items() if k != "by_group"}, ensure_ascii=False))


if __name__ == "__main__":
    _main()
