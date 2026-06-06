# Glassbox

**Agent swarms are black boxes. Glassbox is the glass cockpit that lets you watch a
self-improving swarm build real code, graded live against ground truth.**

A planner, coordinator, worker agents, a validator, and an improver coordinate over
Agent Mail and Beads to port a BPE tokenizer to Rust. Every run is graded by a hard
oracle (exact token-ID match versus tiktoken), Weave traces and scores everything,
and the planner rewrites its own skill from the Weave evals so correctness climbs
across versions: **v1 0.14 to v7 1.00, on its own.**

Built at WeaveHacks 4 (W&B SF). Weave project:
https://wandb.ai/whitely-white-elk-llc/glassbox/weave

![cockpit](docs/board-verify.png)

## Why it wins

- **The glass box plus ground truth.** Most teams build orchestration. Glassbox
  makes it legible (a tldraw cockpit animating every bead) and grades it against a
  hard oracle, so the quality signal is real, not asserted.
- **Genuine self-improvement.** The improver reads which input categories failed in
  the Weave eval and rewrites `planner/SKILL.md` to add the missing category bead.
  The skill materially evolves v1 to v7 (snapshots in `agents/planner/history/`) and
  the oracle accuracy climbs as a real consequence.
- **Load-bearing sponsors.** Weave grades against the oracle and is the
  self-improvement backbone, Redis is the live bus plus leaderboard, CopilotKit is
  the command bar plus generative UI. None are bolted on.

## Architecture

```
Goal (CopilotKit chat) -> Planner decomposes -> Beads graph (br)
  -> Coordinator routes ready beads -> Workers implement (Agent Mail leases)
  -> Validator runs the tiktoken oracle -> accuracy + Weave Evaluation
  -> Improver reads the Weave gaps -> rewrites planner/SKILL.md -> v(n+1)
  -> repeat (autonomous)

All agents -> Redis Stream glassbox:events -> SSE -> tldraw board
Planner-version scores -> Redis sorted set -> the climbing curve
```

| Layer | Tech |
| --- | --- |
| Coordination | Agent Mail (MCP), Beads (`br`) |
| Observability + eval + self-improvement | W&B Weave + W&B MCP server |
| Event bus + leaderboard | Redis (Streams + sorted sets) |
| Cockpit | Next.js + tldraw + CopilotKit (AG-UI) + recharts |
| Target + oracle | Rust BPE tokenizer vs tiktoken gpt2 (exact token-ID match) |
| Swarm inference | W&B Inference (openai/gpt-oss-120b), Weave-traced |

## Layout

- `apps/web/` cockpit (tldraw board + CopilotKit), port 3100
- `agents/` swarm (planner, coordinator, workers, validator, improver) + FastAPI, port 8100
- `tokenizer-rs/` Rust BPE tokenizer (the build target)
- `harness/` oracle (tiktoken fixtures + diff + Weave Evaluation)
- `contract/` the integration seam (events + capability taxonomy)
- `docs/` PRD, demo script, submission writeup

## Run

```bash
cp .env.example .env       # team keys already set
pnpm install && uv sync
pnpm redis                                 # local Redis :6379
GLASSBOX_PACE_MS=600 pnpm backend          # swarm + server :8100 (paced for the demo)
pnpm web                                   # cockpit :3100
```

Open `http://localhost:3100`. Type "port the BPE tokenizer to Rust" in the command
bar, or use the board buttons: Launch run (single full plan), Run climb (the genuine
self-improvement loop), Run live (the spot-a-gap inject beat).

Ports 3100 and 8100 are deliberate (3000/8000 are reserved on this machine).

See `docs/DEMO.md` for the 3 minute script, `docs/SUBMISSION.md` for the writeup,
`docs/prds/GLASSBOX_PRD.md` for the full plan, and `CLAUDE.md` for conventions.
