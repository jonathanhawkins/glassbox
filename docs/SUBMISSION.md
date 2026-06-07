# Glassbox submission

- **Repo:** https://github.com/jonathanhawkins/glassbox
- **Weave project:** https://wandb.ai/whitely-white-elk-llc/glassbox/weave
- **Demo video:** TODO, add the under 2 minute video link before submitting.

## Summary (2 to 3 sentences)

Agent swarms are black boxes. Glassbox is the glass cockpit that lets you watch a
self-improving swarm (planner, coordinator, worker agents, validator, improver)
genuinely write code, graded live against a checkable oracle. The swarm is
task-agnostic: a task is `{goal, workspace, checkable evaluator}`, and the same swarm
runs any of them, shown on a Rust BPE tokenizer (graded by an exact token-ID diff
against tiktoken), a Python library (graded by its pytest suite), and a
bring-your-own-repo mode where you hand it any real repo plus a test command and it
discovers what is failing and fixes it with the LLM (no safety net), with the
improver rewriting the planner skill from the real eval failures so correctness
climbs across versions.

## What it does and why it is useful

Glassbox makes multi-agent orchestration legible AND measurable. The cockpit (a
tldraw canvas) shows beads (tasks) being created, claimed by workers, validated, and
bounced back on failure, with a correctness curve that climbs as the swarm writes
more correct code. Because every task is graded by a hard, checkable evaluator (an
exact diff or a test suite, never a hardcoded number), the quality signal is real:
Weave shows which sub-agent moved correctness and whether a plan passed cleanly or
thrashed. It is genuinely general: point it at any task with an executable test suite
or a reference to diff, and the same swarm improves it.

## How it is built

- **Orchestration protocols:** MCP (Agent Mail server for agent messaging and file
  leases; W&B MCP server for Weave introspection) and AG-UI (CopilotKit command bar
  to the swarm). Coordination state lives in Beads (the `br` dependency-aware issue
  graph) and a Redis event bus.
- **The swarm (built this weekend):** a planner that decomposes the goal into a
  dependency-aware bead graph (LLM-phrased), a coordinator that routes ready beads,
  worker agents that **genuinely author the code** (W&B Inference writes each piece
  given the current source and the validator's real failing cases, the artifact is
  built and graded, and the edit is kept only if the score actually improves, else a
  vetted reference is the fallback), a validator that builds and runs the task's
  checkable evaluator, and an improver that rewrites the planner skill from the real
  eval gaps. Each is a `@weave.op`, so Weave shows the run as a nested session.
- **The Task + Evaluator abstraction (built this weekend):** `tasks/` holds
  self-contained `{goal, workspace, evaluator, skill}` packages; `harness/evaluator.py`
  defines a pluggable checkable Evaluator returning a uniform result. Two tasks ship:
  a Rust BPE tokenizer that reproduces tiktoken gpt2 byte-for-byte (graded by an exact
  token-ID diff over a 217-line corpus) and a Python `textkit` library (graded by its
  pytest suite). The SAME planner/coordinator/worker/validator/improver runs both.
- **Bring-your-own-repo (built this weekend):** a runtime task kind that turns the
  generality claim into a live demo. From the cockpit you give it a repo (path or git
  URL), a test command, and the files workers may edit. It clones the repo into a
  disposable sandbox (your repo is never mutated), runs the suite once to DISCOVER the
  failing test modules as the scoring groups, then the swarm fixes them with the LLM
  and NO deterministic fallback (an edit is kept only if it genuinely raises the
  pass-rate, else the bead bounces). Test files are read-only to workers (a content
  tripwire enforces it), so the score is purely what the model earned against a real
  suite it had never seen.
- **The self-improvement loop (built this weekend):** the improver reads which groups
  failed in the real eval and rewrites the planner skill to add the missing bead, so
  the skill materially evolves on disk and the score climbs as a real consequence
  (tokenizer ~0.17 to 1.00, textkit 0.52 to 1.00).
- **The cockpit (built this weekend):** Next.js 15/16 + tldraw custom shapes, driven
  entirely by the Redis event stream over SSE, with a per-task recharts correctness
  curve, a task switcher, and a CopilotKit command bar.
- **Inference:** swarm agents (and the code-writing workers) run on W&B Inference
  (OpenAI-compatible, openai/gpt-oss-120b et al.), auto-traced by Weave.

**Third-party dependencies (clearly not ours):** Beads (`br`), Agent Mail
(`mcp_agent_mail`), tldraw, CopilotKit, recharts, the tiktoken reference encoder,
pytest, and Weave/W&B. Patina (a larger Godot-to-Rust port) is referenced as context
only; no Patina code is reused. The swarm, the Task + Evaluator abstraction, both
tasks, the evaluators, the cockpit, and the self-improvement loop are written fresh in
this repo this weekend.

## Per-sponsor usage

- **W&B Weave (observability + eval + self-improvement backbone):** `weave.init` plus
  `@weave.op` on the planner, workers (including the code-authoring LLM calls),
  validator, improver, and the run loop, so each run renders as a nested session of
  sub-agents. On the live path the validator logs a real `weave.Evaluation` for every
  planner version (model = `planner_v{n}`, one scored row per evaluator group plus an
  accuracy / pass@1 / efficiency summary), all under one per-task Evaluation so the
  versions line up as comparable rows. That is the Weave-graded climbing curve, also
  mirrored to a Redis sorted set so the cockpit can tail it. The improver then reads
  that Evaluation summary back FROM Weave to pick its next skill rewrite, falling back
  to the in-process per-group breakdown only if Weave is momentarily unavailable so
  the loop never stalls. The W&B MCP server is wired for inspecting the same runs,
  traces, and evals.
- **Redis (live event bus + leaderboard):** every agent appends structured events to
  the Redis Stream `glassbox:events`; the cockpit tails it over SSE and animates the
  board. The leaderboard is a per-task Redis sorted set
  `glassbox:planner_scores:{task}` (so the two tasks keep separate curves); per-run
  accumulated groups are a Redis set; a poller mirrors the bead graph into Redis.
- **CopilotKit (chat command bar + generative UI):** the operator picks a task and
  types the goal into the CopilotKit command bar to launch a run, and generative-UI
  actions surface the correctness curve and leaderboard as React components, over
  AG-UI to the swarm backend.
- **Credits:** W&B Inference (swarm + worker LLM) and OpenAI/Cursor credits where used.

## Honest limits

Generality is bounded by the evaluator: Glassbox is genuinely general for any task
expressible as "make this test suite or reference pass" (the exact ground truth the
swarm is graded on). It does not claim to solve open-ended tasks with no checkable
success signal. There are two honesty regimes, and we are explicit about both. On the
curated demo tasks (tokenizer, textkit) workers may fall back to a vetted reference
when the model's edit does not build or does not improve the score, so the live board
always climbs; this is logged honestly and the score always comes from the real built
artifact. In bring-your-own-repo mode there is NO fallback by design: every point on
that curve is a test the model actually made pass, with the source repo untouched and
the test files read-only.

## Eligibility

- Brand new repo, built entirely at the hackathon, committed every phase.
- Every third-party dependency is listed above with how it was used.
- Weave project link included above.

## Team

**White Elk Studios.** Jonathan Hawkins, jonathan@whiteelkstudios.com.
X https://x.com/jonathanhawkins, LinkedIn https://www.linkedin.com/in/jonathanhawkins/,
GitHub https://github.com/jonathanhawkins.

## Run it

```bash
cp .env.example .env   # team keys already set
pnpm install && uv sync
pnpm redis             # local Redis :6379
pnpm backend           # swarm + AG-UI server :8100
pnpm web               # cockpit :3100  (open http://localhost:3100)
```

Pick a task (tokenizer or textkit) in the cockpit, then Launch run / Run climb / Run
live. Or click `+ repo` to bring your own: point it at a repo and a test command and
watch it discover the failures and fix them. Ports 3100 (web) and 8100 (backend) are
deliberate (3000/8000 are reserved).
