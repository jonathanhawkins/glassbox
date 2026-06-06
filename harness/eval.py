"""Weave Evaluation + Redis leaderboard for a Glassbox planner version.

What this does, end to end:
  1. Load .env and init Weave at whitely-white-elk-llc/glassbox (entity qualified;
     a bare "glassbox" fails with an entity error).
  2. Build an @weave.op predict(text) -> ids that shells the Rust tokenizer, so a
     real Weave trace exists for the run.
  3. Run a weave.Evaluation over a slice of the fixtures with an exact-match
     scorer, so each planner_version is a comparable row in the Weave UI. If the
     full Evaluation API misbehaves we fall back to a traced summary op so the run
     still shows up.
  4. Score the FULL fixture set with the oracle (this is the authoritative
     accuracy) and ZADD it onto the Redis leaderboard glassbox:planner_scores
     (score = accuracy, member = str(planner_version)).
  5. Optionally append a planner_rewrite event onto glassbox:events.

CLI:
  uv run python -m harness.eval --planner-version 1 \
      --caps merges,regex,byte_level,whitespace
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

from harness.oracle import (  # noqa: E402
    DEFAULT_BIN,
    DEFAULT_FIXTURES,
    load_fixtures,
    run_oracle,
)

# How many fixtures to send through the weave.Evaluation (full set is scored by
# the oracle anyway; the Evaluation is for the per example traces in the UI).
EVAL_SAMPLE_SIZE = 40

WEAVE_ENTITY = "whitely-white-elk-llc"
WEAVE_PROJECT_NAME = "glassbox"
WEAVE_PROJECT = f"{WEAVE_ENTITY}/{WEAVE_PROJECT_NAME}"


def _normalize_caps(caps) -> Optional[list[str]]:
    if isinstance(caps, str):
        out = [c.strip() for c in caps.split(",") if c.strip()]
    elif caps:
        out = [str(c).strip() for c in caps if str(c).strip()]
    else:
        out = None
    return out or None


def _weave_url() -> str:
    """Best effort link to the project's Weave traces."""
    return f"https://wandb.ai/{WEAVE_ENTITY}/{WEAVE_PROJECT_NAME}/weave"


def _update_leaderboard(planner_version: int, accuracy: float) -> bool:
    """ZADD accuracy onto glassbox:planner_scores keyed by planner version.

    Returns True on success, False if Redis is unreachable (non fatal).
    """
    try:
        import redis as redis_lib

        from contract.events import PLANNER_SCORES

        url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
        r = redis_lib.from_url(url, decode_responses=True)
        # member = the planner version, score = accuracy. ZADD overwrites the
        # score for an existing member, so re-running a version updates it.
        r.zadd(PLANNER_SCORES, {str(planner_version): float(accuracy)})
        return True
    except Exception as exc:  # noqa: BLE001 - Redis is best effort here
        print(f"[redis] leaderboard update skipped: {exc}", file=sys.stderr)
        return False


def _emit_rewrite_event(run_id: str, planner_version: int, accuracy: float) -> None:
    """Append a planner_rewrite event to glassbox:events (best effort)."""
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
            payload={"accuracy": accuracy},
        )
        r.xadd(EVENTS_STREAM, {"data": json.dumps(event)})
    except Exception as exc:  # noqa: BLE001
        print(f"[redis] event emit skipped: {exc}", file=sys.stderr)


def _run_weave_eval(
    weave, predict_op, caps_norm: Optional[list[str]], sample: list[dict]
) -> Optional[float]:
    """Run a weave.Evaluation over the sample. Returns the eval's exact-match mean
    or None if the Evaluation API path failed (caller falls back to a summary op).
    """

    @weave.op()
    def exact_match(ids: list[int], output: list[int]) -> dict:
        """Scorer: does the model output equal the reference ids exactly?"""
        return {"exact_match": bool(output == ids)}

    # weave.Evaluation expects rows of model inputs plus any columns the scorer
    # references. Here: text (model input) and ids (reference, used by scorer).
    dataset = [{"text": r["text"], "ids": r["ids"]} for r in sample]

    try:
        evaluation = weave.Evaluation(
            name=f"oracle_caps_{'-'.join(caps_norm) if caps_norm else 'all'}",
            dataset=dataset,
            scorers=[exact_match],
        )
        summary = asyncio.run(evaluation.evaluate(predict_op))
        # Dig the mean out of the (nested) summary dict if present.
        try:
            return float(summary["exact_match"]["exact_match"]["true_fraction"])
        except (KeyError, TypeError):
            try:
                return float(summary["exact_match"]["exact_match"]["true_count"]) / len(
                    sample
                )
            except (KeyError, TypeError, ZeroDivisionError):
                return -1.0  # eval ran but summary shape was unexpected
    except Exception as exc:  # noqa: BLE001 - fall back to a summary op
        print(f"[weave] Evaluation API path failed, using summary op: {exc}",
              file=sys.stderr)
        return None


def evaluate(
    planner_version: int,
    caps: Optional[list[str] | str] = None,
    run_id: str = "",
    bin_path: Optional[str | Path] = None,
    fixtures: str | Path = DEFAULT_FIXTURES,
    emit_event: bool = True,
) -> dict:
    """Grade a planner version: oracle accuracy + Weave trace/eval + Redis ZADD.

    Args:
      planner_version: integer version that becomes the leaderboard member.
      caps: capabilities to enable (list or comma string); None = all = exact.
      run_id: optional run id; if set a planner_rewrite event is emitted.
      bin_path: override the tokenizer binary path.
      fixtures: path to fixtures.jsonl.
      emit_event: whether to append a planner_rewrite event to glassbox:events.

    Returns the oracle metrics dict augmented with:
      planner_version, weave_url, weave_eval_score (or None), leaderboard_updated.
    """
    load_dotenv(ROOT / ".env")
    caps_norm = _normalize_caps(caps)

    # Authoritative score: oracle over the FULL fixture set.
    metrics = run_oracle(bin_path=bin_path, caps=caps_norm, fixtures=fixtures)
    accuracy = metrics["accuracy"]

    binary = Path(bin_path) if bin_path else DEFAULT_BIN
    if not binary.is_absolute():
        binary = ROOT / binary

    weave_eval_score: Optional[float] = None
    weave_url = ""

    # Weave init + traced ops. Network call; tolerate failure so the loop survives.
    try:
        import weave

        weave.init(WEAVE_PROJECT)
        weave_url = _weave_url()

        @weave.op()
        def predict(text: str) -> list[int]:
            """Tokenize one line by shelling the Rust tokenizer (single line)."""
            return _single_predict(binary, caps_norm, text)

        rows = load_fixtures(fixtures)
        sample = rows[:EVAL_SAMPLE_SIZE]

        weave_eval_score = _run_weave_eval(weave, predict, caps_norm, sample)

        if weave_eval_score is None:
            # Fallback path: at least create a traced op + a logged summary so the
            # planner version shows up as a run in the Weave UI.
            @weave.op()
            def eval_summary(
                planner_version: int,
                caps: Optional[list[str]],
                accuracy: float,
                passed: int,
                total: int,
                wall_ms: int,
            ) -> dict:
                """Logged summary so each planner version is a comparable Weave run."""
                return {
                    "planner_version": planner_version,
                    "caps": caps,
                    "accuracy": accuracy,
                    "pass_at_1": accuracy,
                    "passed": passed,
                    "total": total,
                    "wall_ms": wall_ms,
                }

            eval_summary(
                planner_version,
                caps_norm,
                accuracy,
                metrics["passed"],
                metrics["total"],
                metrics["wall_ms"],
            )
    except Exception as exc:  # noqa: BLE001 - Weave is best effort
        print(f"[weave] init/eval skipped: {exc}", file=sys.stderr)

    leaderboard_updated = _update_leaderboard(planner_version, accuracy)
    if emit_event and run_id:
        _emit_rewrite_event(run_id, planner_version, accuracy)

    out = dict(metrics)
    out.update(
        {
            "planner_version": planner_version,
            "weave_url": weave_url,
            "weave_eval_score": weave_eval_score,
            "leaderboard_updated": leaderboard_updated,
            "run_id": run_id,
        }
    )
    return out


# --- helper for the per line predict op ------------------------------------

def _single_predict(
    binary: Path, caps_norm: Optional[list[str]], text: str
) -> list[int]:
    """Shell the tokenizer for a single line and return its ids ([] on any issue)."""
    import subprocess

    if not Path(binary).exists():
        return []
    cmd = [str(binary)]
    if caps_norm:
        cmd += ["--caps", ",".join(caps_norm)]
    try:
        proc = subprocess.run(
            cmd, input=text + "\n", capture_output=True, text=True, timeout=15
        )
    except (subprocess.TimeoutExpired, OSError):
        return []
    if proc.returncode != 0:
        return []
    first = (proc.stdout.split("\n") or [""])[0].strip()
    if not first:
        return []
    try:
        val = json.loads(first)
    except (json.JSONDecodeError, ValueError):
        return []
    if isinstance(val, list) and all(
        isinstance(x, int) and not isinstance(x, bool) for x in val
    ):
        return val
    return []


def _main() -> None:
    ap = argparse.ArgumentParser(
        description="Run the Glassbox Weave Evaluation + leaderboard for a planner version."
    )
    ap.add_argument("--planner-version", type=int, required=True)
    ap.add_argument(
        "--caps",
        default=None,
        help="comma separated capabilities (omit for all = exact)",
    )
    ap.add_argument("--run-id", default="")
    ap.add_argument("--bin", default=None, help="path to the tok binary")
    ap.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    ap.add_argument(
        "--no-event",
        action="store_true",
        help="do not emit a planner_rewrite event",
    )
    args = ap.parse_args()

    res = evaluate(
        planner_version=args.planner_version,
        caps=args.caps,
        run_id=args.run_id,
        bin_path=args.bin,
        fixtures=args.fixtures,
        emit_event=not args.no_event,
    )

    print("=" * 60)
    print(f"planner_version : {res['planner_version']}")
    print(f"caps            : {res['caps']}")
    print(f"accuracy        : {res['accuracy']:.4f}  ({res['passed']}/{res['total']})")
    print(f"pass_at_1       : {res['pass_at_1']:.4f}")
    print(f"wall_ms         : {res['wall_ms']}")
    print(f"weave_eval_score: {res['weave_eval_score']}")
    print(f"leaderboard     : {'updated' if res['leaderboard_updated'] else 'SKIPPED'}")
    if res["weave_url"]:
        print(f"weave_url       : {res['weave_url']}")
    if res["error"]:
        print(f"note            : {res['error']}")
    if res["failed_examples"]:
        ex = res["failed_examples"][0]
        print(f"first failure   : text={ex['text']!r}")
    print("=" * 60)
    # Also dump JSON for programmatic callers / the loop.
    print(json.dumps({k: v for k, v in res.items() if k != "failed_examples"},
                     ensure_ascii=False))


if __name__ == "__main__":
    _main()
