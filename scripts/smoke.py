"""Phase 0 proof of life: a Weave @op trace + a Redis event on glassbox:events.

Run: uv run python scripts/smoke.py
Done when: a trace URL prints, and an event is read back from the stream.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Make repo root importable so `contract.events` resolves when run as a script.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import redis as redis_lib  # noqa: E402
import weave  # noqa: E402

from contract.events import EVENTS_STREAM, make_event  # noqa: E402


@weave.op()
def plan(goal: str) -> list[str]:
    """Trivial planner stand-in so Weave shows a traced op."""
    return [f"bead: {part}" for part in ("load vocab", "encode", "decode")]


def main() -> None:
    entity = os.environ.get("WANDB_ENTITY", "").strip()
    project = os.environ.get("WEAVE_PROJECT", "glassbox")
    weave.init(f"{entity}/{project}" if entity else project)

    beads = plan("port the BPE tokenizer to Rust")
    print(f"[weave] traced plan() -> {len(beads)} beads")

    r = redis_lib.from_url(os.environ["REDIS_URL"], decode_responses=True)
    event = make_event(
        "run_started",
        run_id="smoke",
        planner_version=0,
        agent="planner",
        title="port the BPE tokenizer to Rust",
        payload={"beads": beads},
    )
    msg_id = r.xadd(EVENTS_STREAM, {"data": json.dumps(event)})
    back = r.xrevrange(EVENTS_STREAM, count=1)
    print(f"[redis] XADD {EVENTS_STREAM} id={msg_id} len={r.xlen(EVENTS_STREAM)}")
    print(f"[redis] read back: {back[0][1]['data'][:80]}...")
    print("[ok] substrate proof of life complete")


if __name__ == "__main__":
    main()
