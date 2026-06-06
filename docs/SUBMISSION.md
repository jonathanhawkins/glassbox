# Glassbox submission

**Weave project:** https://wandb.ai/whitely-white-elk-llc/glassbox/weave

## Summary (2 to 3 sentences)

Agent swarms are black boxes. Glassbox is the glass cockpit that lets you watch a
self-improving swarm (planner, coordinator, worker agents, validator, improver)
build real code, graded live against ground truth. The swarm ports a BPE
tokenizer to Rust, every run is scored by a hard oracle (exact token-ID match
versus tiktoken), Weave traces and grades everything, and the planner rewrites
its own skill from the Weave evals so correctness climbs across versions.

## What it does and why it is useful

Glassbox makes multi-agent orchestration legible and measurable. The cockpit (a
tldraw canvas) shows beads (tasks) being created, claimed by workers, validated,
and bounced back on failure, with a correctness curve that climbs as the planner
improves. Because the target has a hard oracle, the quality signal is real, not
asserted: Weave can show which sub-agent actually moved correctness and whether a
plan passed cleanly or thrashed. The cockpit is useful to anyone running an agent
swarm today, and the self-improving planner is useful past the weekend.

## How it is built

- **Orchestration protocols:** MCP (Agent Mail server for agent messaging and file
  leases; W&B MCP server for Weave introspection) and AG-UI (CopilotKit command
  bar to the swarm). Coordination state lives in Beads (the `br` dependency-aware
  issue graph) and a Redis event bus.
- **The swarm (built this weekend):** a planner that decomposes the goal into a
  dependency-aware bead graph, a coordinator that routes ready beads, worker
  agents that implement beads, a validator that runs the oracle, and an improver
  that rewrites the planner skill from the Weave-graded gaps. Each is a
  `@weave.op`, so Weave shows the run as a nested session.
- **The oracle (built this weekend):** a Rust BPE tokenizer that reproduces
  tiktoken gpt2 byte-for-byte (215+ corpus lines, exact merge ranks, the verbatim
  gpt2 regex via fancy-regex), plus a diff harness that emits a Weave Evaluation.
- **The self-improvement loop (built this weekend):** the improver reads which
  input categories failed in the Weave eval and rewrites `planner/SKILL.md` to add
  the missing category bead, so the skill materially evolves v1 to v7 and the
  oracle accuracy climbs as a real consequence (0.14 to 1.00).
- **The cockpit (built this weekend):** Next.js 15/16 + tldraw custom shapes,
  driven entirely by the Redis event stream over SSE, with a recharts correctness
  curve and a CopilotKit command bar.
- **Inference:** swarm agents run on W&B Inference (OpenAI-compatible,
  openai/gpt-oss-120b), auto-traced by Weave.

**Third-party dependencies (clearly not ours):** Beads (`br`), Agent Mail
(`mcp_agent_mail`), tldraw, CopilotKit, recharts, the tiktoken reference encoder,
and Weave/W&B. Patina (a larger Godot-to-Rust port) is referenced as context only;
no Patina code is reused. The planner loop, oracle harness, cockpit, and
self-improvement loop are written fresh in this repo this weekend.

## Per-sponsor usage

- **W&B Weave (observability + eval + self-improvement backbone):** `weave.init`
  plus `@weave.op` on the planner, workers, validator, improver, and the run loop,
  so each run renders as a nested session of sub-agents. A Weave Evaluation scores
  the Rust tokenizer against the tiktoken oracle (exact token-ID match, pass@1).
  The planner-version leaderboard is the climbing curve. The improver consumes the
  Weave-graded per-category failures to rewrite its own skill. The W&B MCP server
  is wired for inspecting runs, traces, and evals.
- **Redis (live event bus + leaderboard):** every agent appends structured events
  to the Redis Stream `glassbox:events`; the cockpit tails it over SSE and animates
  the board. The planner-version leaderboard is a Redis sorted set
  `glassbox:planner_scores`; per-run accumulated capabilities are a Redis set; a
  poller mirrors the bead graph into Redis for board hydration.
- **CopilotKit (chat command bar + generative UI):** the operator types the goal
  ("port the BPE tokenizer to Rust") into the CopilotKit command bar to launch a
  run, and generative-UI actions surface the correctness curve and leaderboard as
  React components, over AG-UI to the swarm backend.
- **Credits:** W&B Inference (swarm LLM, openai/gpt-oss-120b) and OpenAI/Cursor
  credits where used.

## Eligibility

- Brand new repo, built entirely at the hackathon, committed every phase.
- Every third-party dependency is listed above with how it was used.
- Weave project link included above.

## Run it

```bash
cp .env.example .env   # team keys already set
pnpm install && uv sync
pnpm redis             # local Redis :6379
pnpm backend           # swarm + AG-UI server :8100
pnpm web               # cockpit :3100  (open http://localhost:3100)
```

Ports 3100 (web) and 8100 (backend) are deliberate (3000/8000 are reserved).
