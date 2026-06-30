"""Measure the tokenizer eval's wall time: cold first-exec vs warm steady-state.

The oracle records ``wall_ms`` as ONE cold subprocess run over the 217-fixture
corpus, so on macOS it is dominated by first-exec code-sign validation (~270ms),
not by tokenize work. This reruns the SAME invocation N times to separate the
one-time startup cost from the steady-state encode cost. It is the evidence
behind docs/runs/tokenizer-perf.md: the "269 to 141 ms" figure is the eval's
cold wall clock, not the tokenizer's latency.

Usage:
    cargo build --release --manifest-path tokenizer-rs/Cargo.toml
    uv run python scripts/bench_tok.py [runs]
"""
from __future__ import annotations

import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from harness.oracle import DEFAULT_BIN, load_fixtures  # noqa: E402


def main(runs: int = 20) -> None:
    if not DEFAULT_BIN.exists():
        sys.exit(f"binary not found at {DEFAULT_BIN}; build tokenizer-rs first")
    rows = load_fixtures()
    blob = "\n".join(r["text"] for r in rows) + "\n"
    times_ms: list[float] = []
    for _ in range(runs):
        t0 = time.perf_counter()
        proc = subprocess.run(
            [str(DEFAULT_BIN)], input=blob, capture_output=True, text=True
        )
        times_ms.append((time.perf_counter() - t0) * 1000)
        if proc.returncode != 0:
            sys.exit(f"tokenizer exited {proc.returncode}: {proc.stderr[:200]}")
    cold = times_ms[0]
    warm = times_ms[1:] or times_ms
    print(f"fixtures: {len(rows)}   runs: {runs}   binary: {DEFAULT_BIN.name}")
    print(f"cold first-exec wall : {cold:7.1f} ms   (this is the 'wall_ms' the eval reports)")
    print(
        f"warm runs 2..{runs} wall: median {statistics.median(warm):5.1f} ms"
        f"   min {min(warm):.1f} ms   max {max(warm):.1f} ms"
    )
    print("note: warm wall still includes OS process spawn + lazy vocab build, not just encode.")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
