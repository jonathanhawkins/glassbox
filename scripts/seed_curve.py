#!/usr/bin/env python3
"""Snapshot and replay a real planner-version curve so a Redis restart cannot wipe it.

The climbing correctness curve lives in Redis: the per-task sorted set
``glassbox:planner_scores:{task}`` (the curve) plus the companion hash
``glassbox:planner_meta:{task}`` (the leaderboard rows). Redis is in-memory, so
restarting it drops a good overnight or live climb and the cockpit curve goes empty.

This captures a curve to a JSON file and replays it verbatim. It does NOT fabricate
numbers: ``--dump`` reads whatever the swarm actually graded, ``--load`` writes those
exact bytes back, so the seeded curve is the same ground-truth Weave scored. Channel
names come from the shared contract, never hardcoded here.

  # after a good climb (overnight or a clean live run), capture it and commit the file
  uv run python -m scripts.seed_curve --dump --task tokenizer

  # before the demo, or any time Redis restarted, put the real curve back
  uv run python -m scripts.seed_curve --load --task tokenizer

The snapshot defaults to harness/data/curve.{task}.json (alongside the fixtures, and
committed for the same reason: it is captured ground truth, not generated at runtime).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Make the repo root importable whether this is run as `-m scripts.seed_curve` (root
# already on the path) or as `scripts/seed_curve.py` (path form, where it is not).
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import redis as _redis  # noqa: E402

from contract.events import planner_meta_key, planner_scores_key  # noqa: E402

_DEFAULT_URL = "redis://127.0.0.1:6379"


def _redis_url() -> str:
    """REDIS_URL from the environment, else from .env, else the local default.

    Mirrors agents/bus.py so the script talks to the same instance the swarm wrote.
    A tiny self-contained .env read keeps this script free of the agents package.
    """
    url = os.environ.get("REDIS_URL")
    if url:
        return url
    env_file = _ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("REDIS_URL=") and not line.startswith("#"):
                value = line.split("=", 1)[1].strip()
                if value:
                    return value
    return _DEFAULT_URL


def _default_file(task: str) -> Path:
    return _ROOT / "harness" / "data" / f"curve.{task}.json"


def _summary(scores: list[tuple[str, float]]) -> str:
    if not scores:
        return "no graded versions"
    accs = [s for _, s in scores]
    versions = sorted(int(v) for v, _ in scores)
    return (
        f"{len(scores)} version(s) v{versions[0]}..v{versions[-1]}, "
        f"accuracy {min(accs):.3f} to {max(accs):.3f}"
    )


def dump(client: "_redis.Redis", task: str, out: Path, force: bool) -> int:
    scores_key = planner_scores_key(task)
    meta_key = planner_meta_key(task)
    scores = client.zrange(scores_key, 0, -1, withscores=True)  # [(member, score)]
    meta = client.hgetall(meta_key)  # {version_field: json_blob}

    if not scores and not force:
        print(
            f"[seed_curve] refusing to dump an empty curve for task={task!r} "
            f"(key {scores_key} is empty). Run a climb first, or pass --force to "
            f"overwrite {out} with an empty snapshot.",
            file=sys.stderr,
        )
        return 1

    snapshot = {
        "task": task,
        "scores_key": scores_key,
        "meta_key": meta_key,
        # members kept as strings (str(version)); scores as floats. Verbatim, so the
        # replay is byte-faithful and needs no knowledge of the meta record shape.
        "scores": [[member, float(score)] for member, score in scores],
        "meta": dict(meta),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    print(f"[seed_curve] dumped {_summary(scores)} for task={task!r} to {out}")
    return 0


def load(client: "_redis.Redis", task: str, src: Path, force: bool) -> int:
    if not src.exists():
        print(f"[seed_curve] no snapshot at {src}", file=sys.stderr)
        return 1
    snapshot = json.loads(src.read_text())
    snap_task = snapshot.get("task", task)
    if snap_task != task and not force:
        print(
            f"[seed_curve] snapshot is for task={snap_task!r} but --task={task!r}. "
            f"Pass --force to load it anyway.",
            file=sys.stderr,
        )
        return 1

    # Always target the live contract keys for the requested task (do not trust keys
    # baked into the file, so a renamed contract still lands in the right place).
    scores_key = planner_scores_key(task)
    meta_key = planner_meta_key(task)
    scores = [(str(member), float(score)) for member, score in snapshot.get("scores", [])]
    meta = {str(field): blob for field, blob in (snapshot.get("meta") or {}).items()}

    # Restore is a clean replace: a stale partial curve in Redis must not bleed through.
    pipe = client.pipeline()
    pipe.delete(scores_key)
    pipe.delete(meta_key)
    if scores:
        pipe.zadd(scores_key, {member: score for member, score in scores})
    if meta:
        pipe.hset(meta_key, mapping=meta)
    pipe.execute()
    print(f"[seed_curve] loaded {_summary(scores)} for task={task!r} from {src}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dump", action="store_true", help="Redis curve -> JSON file")
    mode.add_argument("--load", action="store_true", help="JSON file -> Redis curve")
    parser.add_argument("--task", default="tokenizer", help="task name (default: tokenizer)")
    parser.add_argument("--file", default=None, help="snapshot path (default: harness/data/curve.{task}.json)")
    parser.add_argument(
        "--force",
        action="store_true",
        help="allow dumping an empty curve, or loading a snapshot from another task",
    )
    args = parser.parse_args()

    task = (args.task or "tokenizer").strip() or "tokenizer"
    path = Path(args.file) if args.file else _default_file(task)

    try:
        client = _redis.from_url(_redis_url(), decode_responses=True)
        client.ping()
    except Exception as exc:  # noqa: BLE001 - a clear message beats a stack trace here
        print(f"[seed_curve] cannot reach Redis at {_redis_url()}: {exc}", file=sys.stderr)
        return 2

    if args.dump:
        return dump(client, task, path, args.force)
    return load(client, task, path, args.force)


if __name__ == "__main__":
    raise SystemExit(main())
