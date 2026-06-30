# Run evidence

Reproducible artifacts behind the headline numbers, so each claim is backed by a
committed file you can regenerate, not a demo recollection. Everything here was
produced by the scripts in `scripts/`, against the real oracle / pytest, on a clean
tree.

## Self-improving climb (per-version, oracle-graded)

`tokenizer-climb.json` and `textkit-climb.json` are full runs of the genuine
`agents.run.improve_loop`: each version plans from the current planner skill, the
workers author the source, the artifact is rebuilt, and the **real** evaluator scores
it (tiktoken gpt2 exact token-id diff for the tokenizer, pytest for textkit). The
improver then rewrites the skill to cover the biggest failing group and the next
version replans. Each file carries the per-version accuracy, the per-group pass/fail
breakdown, and which category the improver added.

Tokenizer (217 fixtures, exact token-id match vs tiktoken gpt2):

| version | adds | accuracy |
| --- | --- | --- |
| v1 | ascii (baseline) | 0.17 |
| v2 | punctuation | 0.57 |
| v3 | numbers | 0.71 |
| v4 | unicode | 0.86 |
| v5 | whitespace | 1.00 |
| v6 | code (free) | 1.00 |
| v7 | emoji (free) | 1.00 |

textkit (21 pytest cases across 4 modules):

| version | accuracy |
| --- | --- |
| v1 | 0.52 |
| v2 | 0.71 |
| v3 | 0.86 |
| v4 | 1.00 |

Honest framing: these were generated with `GLASSBOX_WORKER_LLM=0`, the deterministic
curriculum path, so they are reproducible by anyone with no API key. The **scores are
real evaluator measurements** of the rebuilt artifact either way (a kept LLM edit must
still beat the oracle to survive). So this backs "accuracy climbs across versions,
oracle-graded," not "a model emergently discovered the answer." The model-authored,
no-fallback path is the bring-your-own-repo task (`tasks/byo/`), where there is no
deterministic answer to fall back to.

Regenerate:

```bash
pnpm redis            # local Redis :6379
uv run python scripts/capture_climb.py            # both tasks
uv run python scripts/capture_climb.py tokenizer 8
```

## Tokenizer perf

See `tokenizer-perf.md`. Short version: the "269 to 141 ms" figure is the eval's cold
first-exec wall clock (macOS code-sign, ~270 ms), not tokenize latency. Measured warm
tokenize over all 217 fixtures is ~4 ms, and exact-match accuracy holds at 1.000.
`scripts/bench_tok.py` reproduces the cold-vs-warm split.

## Loop stop conditions (live path)

The Sweep (backlog drained) and Climb (metric plateau) auto-stop detectors are unit
tested in `apps/web/src/lib/fleet/loop-monitor.test.ts` (19 cases, all passing):

```
# pass 19   # fail 0
```

This backs "the cockpit auto-detects a drained backlog / a plateau and tears the swarm
down" as tested logic. A specific live landing (a real Claude Code swarm draining a
4-file backlog in ~8 minutes) is a demo run on the voxherd-bridge stack; it is not
checked in as an artifact. The other six loop shapes are selectable and redraw the
board, but only Sweep and Climb have autonomous coded stop-detection; the rest stop on
the agent's self-reported `LOOP_DONE` sentinel, a round budget, or a manual stop.
