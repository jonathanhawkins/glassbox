#!/usr/bin/env python3
"""Verify the tok binary against fixtures.jsonl.

Runs in two ways for each cap setting:
  1. Batch: pipe corpus.txt into one tok invocation, compare line by line.
  2. Reports exact match accuracy.

Invoked from the repo root so it mirrors the oracle (tokenizer-rs/target/release/tok).
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BIN = REPO / "tokenizer-rs" / "target" / "release" / "tok"
FIXTURES = REPO / "harness" / "data" / "fixtures.jsonl"
CORPUS = REPO / "harness" / "data" / "corpus.txt"


def load_fixtures():
    texts, ids = [], []
    with open(FIXTURES, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            obj = json.loads(line)
            texts.append(obj["text"])
            ids.append(obj["ids"])
    return texts, ids


def run_batch(caps=None):
    corpus_bytes = CORPUS.read_bytes()
    args = [str(BIN)]
    if caps is not None:
        args += ["--caps", caps]
    proc = subprocess.run(
        args, input=corpus_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=str(REPO)
    )
    if proc.returncode != 0:
        print("STDERR:", proc.stderr.decode("utf-8", "replace"), file=sys.stderr)
        raise SystemExit(f"tok exited {proc.returncode}")
    out_lines = proc.stdout.decode("utf-8").split("\n")
    # Drop a single trailing empty line from the final newline.
    if out_lines and out_lines[-1] == "":
        out_lines.pop()
    return [json.loads(x) for x in out_lines]


def accuracy(predicted, expected):
    n = min(len(predicted), len(expected))
    match = sum(1 for i in range(n) if predicted[i] == expected[i])
    total = max(len(predicted), len(expected))
    return match / total, match, total


def main():
    texts, expected = load_fixtures()
    print(f"fixtures: {len(expected)} lines; corpus lines: {len(CORPUS.read_text(encoding='utf-8').split(chr(10))) - 1}")

    # 1. Default (all caps on) must be exact.
    pred = run_batch(None)
    acc, m, t = accuracy(pred, expected)
    print(f"[default all-on] accuracy={acc:.6f} ({m}/{t})")
    if acc != 1.0:
        # Show first few mismatches.
        shown = 0
        for i in range(min(len(pred), len(expected))):
            if pred[i] != expected[i]:
                print(f"  MISMATCH line {i}: text={texts[i]!r}")
                print(f"    expected={expected[i]}")
                print(f"    got     ={pred[i]}")
                shown += 1
                if shown >= 8:
                    break

    # 2. Explicit all caps on (and literal "all") must also be exact.
    pred_all_flags = run_batch("merges,regex,byte_level,whitespace")
    acc2, _, _ = accuracy(pred_all_flags, expected)
    print(f"[--caps merges,regex,byte_level,whitespace] accuracy={acc2:.6f}")
    pred_all = run_batch("all")
    acc_all, _, _ = accuracy(pred_all, expected)
    print(f"[--caps all] accuracy={acc_all:.6f}")

    # 3. Degraded sets must be < 1.0.
    for spec in ["merges,regex", "regex,byte_level,whitespace", "merges,byte_level,whitespace",
                 "merges,regex,whitespace", "merges,regex,byte_level"]:
        predd = run_batch(spec)
        accd, md, td = accuracy(predd, expected)
        flag = "OK(<1)" if accd < 1.0 else "BAD(==1)"
        print(f"[--caps {spec}] accuracy={accd:.6f} ({md}/{td}) {flag}")

    # 4. Roundtrip decode check on the default output.
    ids_json = "\n".join(json.dumps(x, separators=(",", ":")) for x in pred)
    dproc = subprocess.run(
        [str(BIN), "decode"], input=ids_json.encode("utf-8"),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=str(REPO),
    )
    dec_lines = dproc.stdout.decode("utf-8").split("\n")
    if dec_lines and dec_lines[-1] == "":
        dec_lines.pop()
    rt_ok = dec_lines == texts
    print(f"[decode roundtrip] match={rt_ok} ({sum(1 for a,b in zip(dec_lines,texts) if a==b)}/{len(texts)})")
    if not rt_ok:
        for i in range(min(len(dec_lines), len(texts))):
            if dec_lines[i] != texts[i]:
                print(f"  RT MISMATCH line {i}: expected={texts[i]!r} got={dec_lines[i]!r}")
                break

    # Final verdict line for easy parsing.
    print(f"FINAL_ACCURACY={acc:.6f}")
    return 0 if acc == 1.0 and acc2 == 1.0 and acc_all == 1.0 else 1


if __name__ == "__main__":
    sys.exit(main())
