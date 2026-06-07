"""The hard oracle: run the Rust tokenizer over the fixture corpus and diff its
token IDs against tiktoken gpt2 ground truth (exact match per line).

The Rust binary (tokenizer-rs/target/release/tok) reads stdin lines and prints
one JSON array of token IDs per line. There is no gating: the binary always runs
the exact tiktoken algorithm over whatever pretokenizer its source currently
defines, so accuracy is a genuine function of the tokenizer source (the swarm
edits tokenizer-rs/src/pretok.rs and the score follows). The fixtures carry a
``category`` field used only to report a per-category (by_group) failure
breakdown, which steers the improver.

This module is defensive on purpose: the Rust binary is built in parallel and may
be missing, a stub (no output), or partially implemented (wrong line count, bad
JSON). In every such case run_oracle returns accuracy 0.0 with a clear error
string instead of raising, so the self-improvement loop never crashes.

CLI:
  uv run python -m harness.oracle [--bin PATH] [--fixtures PATH]
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import time
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BIN = ROOT / "tokenizer-rs" / "target" / "release" / "tok"
DEFAULT_FIXTURES = ROOT / "harness" / "data" / "fixtures.jsonl"

# Guard rails so a runaway / hanging binary cannot wedge the loop.
RUN_TIMEOUT_S = 60
MAX_FAILED_EXAMPLES = 10


def _resolve_bin(bin_path: Optional[str | Path]) -> Path:
    """Resolve the tokenizer binary path (default tokenizer-rs/target/release/tok)."""
    if bin_path is None:
        return DEFAULT_BIN
    p = Path(bin_path)
    return p if p.is_absolute() else (ROOT / p)


def _resolve_fixtures(fixtures: str | Path) -> Path:
    p = Path(fixtures)
    return p if p.is_absolute() else (ROOT / p)


def load_fixtures(fixtures: str | Path = DEFAULT_FIXTURES) -> list[dict]:
    """Load fixtures.jsonl into a list of {"text": str, "ids": list[int]}."""
    path = _resolve_fixtures(fixtures)
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def _parse_ids(line: str) -> Optional[list[int]]:
    """Parse one output line as a JSON array of ints. Returns None on any problem."""
    line = line.strip()
    if not line:
        return None
    try:
        val = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(val, list):
        return None
    out: list[int] = []
    for x in val:
        if isinstance(x, bool) or not isinstance(x, int):
            return None
        out.append(x)
    return out


def _empty_result(caps, total, error, wall_ms=0) -> dict:
    return {
        "accuracy": 0.0,
        "passed": 0,
        "total": total,
        "pass_at_1": 0.0,
        "wall_ms": wall_ms,
        "caps": caps,
        "failed_examples": [],
        "by_category": {},
        "error": error,
    }


def run_oracle(
    bin_path: Optional[str | Path] = None,
    caps: Optional[list[str] | str] = None,
    fixtures: str | Path = DEFAULT_FIXTURES,
    seed: Optional[int] = None,
    sample_min: int = 12,
) -> dict:
    """Run the Rust tokenizer over every fixture once and score exact-match accuracy.

    Args:
      bin_path: path to the tok binary. Defaults to tokenizer-rs/target/release/tok.
      caps: categories to enable, as a list ["ascii", "numbers", ...] or a comma
            separated string. None or empty means all categories (exact).
      fixtures: path to fixtures.jsonl (the read-only ground truth).

    Returns a dict:
      {
        "accuracy": float,         # 0..1 exact-match fraction
        "passed": int,             # lines whose ids matched exactly
        "total": int,              # number of fixtures
        "pass_at_1": float,        # == accuracy (single shot, no retries)
        "wall_ms": int,            # wall time of the binary run
        "caps": list[str] | None,  # normalized caps that were requested
        "failed_examples": list,   # up to 10 of {"text","expected","got"}
        "error": str,              # "" on success, else a human readable reason
      }
    """
    # Normalize caps to a list (or None for "all").
    if isinstance(caps, str):
        caps_list = [c.strip() for c in caps.split(",") if c.strip()]
    elif caps:
        caps_list = [str(c).strip() for c in caps if str(c).strip()]
    else:
        caps_list = None
    caps_norm = caps_list if caps_list else None

    rows = load_fixtures(fixtures)
    # Optional seeded per-run sampling: a held-out eval batch whose per-category
    # sizes vary by run, so the failure magnitudes (and thus the improver's
    # priority) are genuinely data-driven and differ run to run. seed=None scores
    # the full corpus (deterministic, used by the CLI and tests).
    if seed is not None:
        by_cat_rows: dict[str, list] = {}
        for idx, r in enumerate(rows):
            by_cat_rows.setdefault(str(r.get("category", "?")), []).append((idx, r))
        chosen: list = []
        for cat, items in by_cat_rows.items():
            rnd = random.Random(f"{seed}:{cat}")
            hi = max(sample_min, len(items) - 4)
            k = len(items) if len(items) <= sample_min else rnd.randint(sample_min, hi)
            chosen.extend(rnd.sample(items, k))
        chosen.sort(key=lambda t: t[0])
        rows = [r for _idx, r in chosen]
    total = len(rows)
    texts = [r["text"] for r in rows]
    expected_ids = [r["ids"] for r in rows]
    categories = [str(r.get("category", "?")) for r in rows]

    binary = _resolve_bin(bin_path)
    if not binary.exists():
        return _empty_result(
            caps_norm,
            total,
            f"tokenizer binary not found at {binary} (build tokenizer-rs first)",
        )

    cmd = [str(binary)]
    # The binary is de-gated (no --caps): it always runs the exact tiktoken
    # algorithm over whatever its source currently defines, so accuracy is a
    # genuine function of the tokenizer source. `caps` is accepted by run_oracle
    # for backward compatibility but is intentionally NOT passed to the binary.
    _ = caps_norm

    # One fixture text per stdin line. Texts are guaranteed newline free by the
    # fixture generator, so line index maps 1:1 to fixture index.
    stdin_blob = "\n".join(texts) + "\n"

    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            input=stdin_blob,
            capture_output=True,
            text=True,
            timeout=RUN_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        wall_ms = int((time.perf_counter() - t0) * 1000)
        return _empty_result(
            caps_norm, total, f"tokenizer timed out after {RUN_TIMEOUT_S}s", wall_ms
        )
    except OSError as exc:
        wall_ms = int((time.perf_counter() - t0) * 1000)
        return _empty_result(caps_norm, total, f"failed to run tokenizer: {exc}", wall_ms)
    wall_ms = int((time.perf_counter() - t0) * 1000)

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip().replace("\n", " ")
        return _empty_result(
            caps_norm,
            total,
            f"tokenizer exited {proc.returncode}: {stderr[:300]}",
            wall_ms,
        )

    # Split output into per line id arrays. A trailing newline yields a trailing
    # empty entry which we drop.
    out_lines = proc.stdout.split("\n")
    if out_lines and out_lines[-1] == "":
        out_lines.pop()

    if len(out_lines) == 0:
        return _empty_result(
            caps_norm,
            total,
            "tokenizer produced no output (likely an unimplemented stub)",
            wall_ms,
        )

    passed = 0
    failed_examples: list[dict] = []
    parse_errors = 0
    # Per-category exact-match tally so the validator can report which categories
    # are failing and by HOW MUCH (the real signal the improver prioritizes on).
    cat_total: dict[str, int] = {}
    cat_passed: dict[str, int] = {}
    for c in categories:
        cat_total[c] = cat_total.get(c, 0) + 1
    n = min(len(out_lines), total)
    for i in range(n):
        cat = categories[i]
        got = _parse_ids(out_lines[i])
        if got is None:
            parse_errors += 1
            if len(failed_examples) < MAX_FAILED_EXAMPLES:
                failed_examples.append(
                    {
                        "text": texts[i],
                        "expected": expected_ids[i],
                        "got": out_lines[i].strip()[:200],
                        "category": cat,
                    }
                )
            continue
        if got == expected_ids[i]:
            passed += 1
            cat_passed[cat] = cat_passed.get(cat, 0) + 1
        elif len(failed_examples) < MAX_FAILED_EXAMPLES:
            failed_examples.append(
                {
                    "text": texts[i],
                    "expected": expected_ids[i],
                    "got": got,
                    "category": cat,
                }
            )

    # accuracy is over ALL fixtures, so a short/long output is penalized.
    accuracy = passed / total if total else 0.0
    by_category = {
        c: {
            "total": cat_total.get(c, 0),
            "passed": cat_passed.get(c, 0),
            "failed": cat_total.get(c, 0) - cat_passed.get(c, 0),
        }
        for c in cat_total
    }

    error = ""
    if len(out_lines) != total:
        error = (
            f"line count mismatch: tokenizer printed {len(out_lines)} lines "
            f"for {total} fixtures"
        )
    elif parse_errors:
        error = f"{parse_errors} output line(s) were not valid JSON int arrays"

    return {
        "accuracy": accuracy,
        "passed": passed,
        "total": total,
        "pass_at_1": accuracy,
        "wall_ms": wall_ms,
        "caps": caps_norm,
        "failed_examples": failed_examples,
        "by_category": by_category,
        "seed": seed,
        "error": error,
    }


def _main() -> None:
    ap = argparse.ArgumentParser(description="Run the Glassbox tokenizer oracle diff.")
    ap.add_argument("--bin", default=None, help="path to the tok binary")
    ap.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    args = ap.parse_args()

    res = run_oracle(bin_path=args.bin, fixtures=args.fixtures)
    # Print a compact human summary plus the full JSON.
    print(
        f"accuracy={res['accuracy']:.4f} "
        f"passed={res['passed']}/{res['total']} "
        f"wall_ms={res['wall_ms']}"
    )
    if res["error"]:
        print(f"note: {res['error']}")
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _main()
