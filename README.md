# Glassbox

Agent swarms are black boxes. Glassbox is the glass cockpit that lets you watch a
self-improving swarm build real code, graded live against ground truth.

A planner, coordinator, worker agents, and a validator coordinate over Agent Mail and
Beads to port a BPE tokenizer to Rust. Every run is graded against a hard oracle (exact
token-ID match vs a reference tokenizer), Weave traces and scores everything, and the
planner rewrites its own skill from the Weave evals so correctness climbs across versions.

## Stack

- **Coordination**: Agent Mail (MCP), Beads (`br`)
- **Observability + eval**: W&B Weave + W&B MCP server
- **Event bus + leaderboard**: Redis (Streams + sorted sets)
- **Cockpit**: Next.js 15 + tldraw + CopilotKit (AG-UI)
- **Target**: Rust BPE tokenizer, oracle = tiktoken (gpt2)

## Run

```bash
cp .env.example .env      # fill WANDB_API_KEY etc. (already set for the team)
pnpm install              # JS workspace
uv sync                   # Python swarm env (3.12)
pnpm redis                # local Redis on :6379
pnpm web                  # cockpit on :3100
pnpm backend              # swarm/AG-UI server on :8100
```

Ports 3100 (web) and 8100 (backend) are used deliberately (3000/8000 are reserved).

See `docs/prds/GLASSBOX_PRD.md` for the full plan and `CLAUDE.md` for conventions.
