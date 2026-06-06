# Glassbox (WeaveHacks 4)

Glass cockpit over a self-improving agent swarm that ports a BPE tokenizer to Rust,
graded live against a hard oracle (exact token-ID match). See `docs/prds/GLASSBOX_PRD.md`.

## Conventions (all agents follow these)

- **Ports: frontend `3100`, backend `8100`. NEVER use 3000 or 8000 (reserved).**
- **Voice: no em dashes** in any user-facing copy, README, slides, or commits. Use periods, commas, parentheses.
- **Commit every 20-30 min** with clear messages. Frequent commits are the signal this was built this weekend.
- Co-author commits: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Layout

- `apps/web/` - Next.js 15 cockpit (tldraw board + CopilotKit), port 3100
- `agents/` - Python swarm (planner, coordinator, workers, validator, improver) + AG-UI/FastAPI server, port 8100
- `tokenizer-rs/` - Rust BPE tokenizer crate (the build target)
- `harness/` - oracle: fixtures (tiktoken gpt2) + diff harness + Weave Evaluation
- `contract/` - the integration seam: `index.ts` (TS) and `events.py` (Python) over `glassbox.contract.json`
- `scripts/` - run/orchestration helpers

## Integration contract (the seam)

Both sides build against `contract/glassbox.contract.json`. Do not hardcode channel names.
- TS: `import { REDIS, EVENT_TYPES, type GlassboxEvent } from "@glassbox/contract"`
- Python: `from contract.events import EVENTS_STREAM, make_event`
- Redis stream `glassbox:events` carries every event. Leaderboard is sorted set `glassbox:planner_scores`.
- Event envelope: `{ ts, type, run_id, planner_version, agent, bead_id, title, payload }`.

## Tooling

- **Beads = `br`** (beads_rust), NOT `bd`. Workspace in `.beads/`. Use `br create`, `br ready --json`, `br update --status in_progress`, `br close`.
- **Agent Mail** = MCP server `mcp-agent-mail` (already configured) for agent-to-agent messaging and file leases.
- **Weave**: `weave.init("glassbox")`; decorate planner/worker/validator/improver with `@weave.op()`.
- **LLM**: W&B Inference (OpenAI-compatible) via `OPENAI_BASE_URL` + `OPENAI_API_KEY` (the W&B key). Model in `GLASSBOX_LLM_MODEL`. Weave auto-traces OpenAI calls.
- **Python**: use the root uv venv (`uv run ...`, Python 3.12). **Node**: pnpm workspace.
- Secrets live in `.env` (gitignored). Never commit `.env` or echo keys.
