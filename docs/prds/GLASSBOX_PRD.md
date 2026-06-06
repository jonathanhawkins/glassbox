# Glassbox: PRD and Weekend Build Plan

**Event:** WeaveHacks 4 (Multi-Agent Orchestration), Weights & Biases SF, 400 Alabama St.
**Clock:** Hacking opens Sat 11:15am. Submissions due Sun 1:00pm. Office: Sat until 9pm, Sun from 9am. Loop runs autonomously overnight.
**Theme fit:** Multi-agent orchestration, wrangling swarms, self-improving loops.
**One-liner:** Agent swarms are black boxes. Glassbox is the glass cockpit that lets you watch a self-improving swarm build real code, graded live against ground truth.

---

## 0. Read this first (Claude Code, start here)

**What we are building, in two sentences.** Glassbox is a live command center over an agent swarm (planner + coordinator + worker agents + validator) that ports a BPE tokenizer to Rust. The swarm coordinates over Agent Mail and Beads, every run is graded against a hard oracle (exact token-ID match vs a reference tokenizer), Weave traces and scores everything, and the planner rewrites its own skill from the Weave evals so correctness climbs across versions.

**Prime directive / definition of done for the weekend:** a 3 minute demo where (1) a goal typed into chat triggers a visible decomposition into beads on a canvas, (2) worker agents pick up beads and a validator grades the result against the oracle with a real correctness number, and (3) a Weave-graded correctness curve climbs across planner versions. Everything else is gravy.

**Eligibility guardrails (CRITICAL, do not violate):**
- Brand new GitHub repo, public, created today. The entire evaluated project is built at the hackathon.
- Beads, Agent Mail, tldraw, CopilotKit, and the reference tokenizer are third-party dependencies. That is allowed. List every one of them in the submission with how it was used.
- Patina is referenced as "the larger Godot-to-Rust port this connects to," not reused. The planner loop, the oracle harness, the cockpit, and the self-improvement loop are written fresh in this repo this weekend. Do not copy Patina code in.
- Commit every 20 to 30 minutes with clear messages. Frequent commits are the signal to judges that this was built this weekend.
- Weave is mandatory for prize eligibility (it is two lines). Include the Weave project link in the submission even if the project stays private.

**Voice:** no em dashes anywhere in user-facing copy, slides, README, or submission text. Use periods, commas, and parentheses.

**Working name:** Glassbox (rename freely). It names the value prop directly: the opposite of a black box, and it pairs with Weave observability.

---

## 1. The product and why it wins

The pain is real and the room knows it: orchestration systems like Agent Mail and Beads are powerful, but the UX is a wall of tmux panes. Nobody, including the operator, can see what the swarm is actually doing or whether the agents are adding value. Glassbox turns that wall of text into a glass cockpit.

Mapped to the judging criteria:
- **Creativity ("have you seen this before?").** Most teams will build orchestration. Few will build the cockpit that makes orchestration legible, and almost none will grade it against a hard oracle so the quality signal is real. The novelty is the glass box plus ground truth, not the swarm itself.
- **Harness sophistication (most heavily weighted).** A planner, a coordinator, parallel worker agents, and a validator coordinating over Agent Mail and Beads, with a dependency-aware bead graph, is a genuinely complex multi-agent environment, and the board makes that complexity visible on screen.
- **Utility.** A self-improving planner that gets measurably better at decomposing a real engineering task is useful past Sunday. The cockpit is useful to anyone running Agent Mail or Beads today.
- **Technical execution.** A hard oracle (exact token-ID diff) means "it works" is provable live, not asserted.
- **Sponsor usage.** Weave grades against the oracle, Redis is the live event bus plus leaderboard, CopilotKit is the chat command bar and generative UI. All three are load-bearing, none are bolted on.

**The framing line for the pitch:** "the target is a tokenizer because it gives us ground truth. The product is the swarm and the cockpit."

---

## 2. Architecture

**Components**
- **Planner agent.** Takes the high-level goal and decomposes it into a Beads dependency graph. Owns the skill/prompt that gets rewritten by the improvement loop.
- **Coordinator.** Reads `bd ready --json`, routes unblocked beads to available workers, posts assignments over Agent Mail.
- **Worker agents (2 to 4).** Claim a bead, do the Rust work in an isolated worktree, coordinate file ownership via Agent Mail leases, close the bead.
- **Validator.** Runs the oracle diff (Rust output vs reference token IDs), produces a correctness score plus trajectory metrics, logs the eval to Weave, bounces failures back as new beads.
- **Improver (meta) agent.** Reads the Weave eval results via the W&B MCP server and rewrites the planner skill to fix observed decomposition gaps. Produces planner v(n+1).
- **Event tap.** Agents emit structured events to a Redis Stream. The frontend tails them and animates the board.
- **Cockpit (Next.js + tldraw + CopilotKit).** The glass box: lanes, agents, the bead chain, the correctness curve, and a chat command bar.

**Data flow**
```
Goal (typed in CopilotKit chat)
   -> Planner decomposes -> Beads graph (.beads/issues.jsonl via bd)
   -> Coordinator reads `bd ready --json` -> assigns via Agent Mail
   -> Workers claim/close beads (bd), coordinate file leases (Agent Mail)
   -> Validator runs oracle diff -> correctness + metrics -> Weave eval
   -> Improver reads Weave evals (W&B MCP) -> rewrites planner skill -> v(n+1)
   -> repeat (autonomous overnight)

All agents -> emit events -> Redis Stream -> SSE/WebSocket -> tldraw board
Run history + planner-version scores -> Redis sorted sets -> CopilotKit charts
```

**Key decision:** wire the board to the swarm through Redis from hour one. Do not build frontend and backend in isolation and integrate Sunday morning. The single integration contract is the event schema in Section 9.

---

## 3. Tech stack

| Layer | Tech | Role |
| --- | --- | --- |
| Coordination | **Agent Mail** (`Dicklesworthstone/mcp_agent_mail`, Rust variant optional) | Agent-to-agent messaging, identities, advisory file leases |
| Task graph | **Beads** (`steveyegge/beads`, `bd` CLI + `beads-mcp`) | Dependency-aware bead graph, `bd ready`, JSONL state |
| Observability + eval | **W&B Weave** (`weave`) + **W&B MCP server** (`mcp.withwandb.com`) | Trace sessions/turns/sub-agents, Evaluation scorer, self-improvement backbone |
| Inference (optional) | **W&B Inference** + OpenAI (credits) | Run swarm agents inside the sponsor ecosystem |
| Target artifact | **Rust** (cargo) BPE tokenizer | The thing being built, gives a hard oracle |
| Oracle reference | **tiktoken** (Python) or HuggingFace `tokenizers` | Ground-truth token IDs to diff against |
| Event bus + store | **Redis** (Streams + sorted sets) | Live event stream, run history, planner-version leaderboard |
| Frontend shell | **Next.js 15** + **TypeScript** + **Tailwind** + **shadcn/ui** | App shell (your stack) |
| Canvas / cockpit | **tldraw** SDK | The glass-box board: lanes, agents, bead chain, animations |
| Chat + gen UI | **CopilotKit** (`@copilotkit/react-core`, `react-ui`) over **AG-UI** | Command bar to launch goals, generative UI for charts |
| Tooling | pnpm, uv, Ghostty, Claude Code | Build environment |

Docs to consult during build: tldraw `https://tldraw.dev`, CopilotKit `https://copilotkit.ai` and the AG-UI docs, Beads `https://steveyegge.github.io/beads/`, Agent Mail `https://github.com/Dicklesworthstone/mcp_agent_mail`, Weave `https://weave-docs.wandb.ai/`, Weave + MCP `https://weave-docs.wandb.ai/guides/integrations/mcp/`.

---

## 4. The target: BPE tokenizer + oracle

**Why a tokenizer.** Fast cycles, exact and un-gameable diff, instantly legible to an AI room, and it decomposes into enough semi-independent parts that the swarm has real parallel work to do. It is the scoreboard, not the star.

**Oracle.** Pick a fixed encoding from the reference (suggest `tiktoken` `cl100k_base` or `gpt2` for trivial fixture generation). Generate a corpus of a few hundred to a few thousand lines that includes plain English, code, punctuation, multibyte unicode, and emoji. Run the reference `encode` to produce the canonical token-ID sequence for each line and save as fixtures. The Rust crate must reproduce identical token IDs on `encode` and round-trip on `decode`.

**Score (this is what Weave grades):**
- Primary: exact-match accuracy = fraction of corpus lines whose Rust token IDs equal the reference exactly.
- Honesty column: pass@1 (one shot, no retries) so looping cannot inflate the number.
- Efficiency: iterations, tokens, and wall time per passing bead, so a skill that limps across the line ranks below one that nails it cheaply.
- Anti-gaming: the eval harness and fixtures are read-only to workers, and the Weave trace is watched for test tampering or hardcoded outputs.

**Bead decomposition (the planner should produce roughly this, 8 beads, several parallelizable):**
1. Load vocab and BPE merge ranks.
2. Byte-level encoding (the GPT-2 byte-to-unicode mapping).
3. Regex pre-tokenization (the encoding's split pattern).
4. BPE merge loop (rank-based pair merging).
5. Special-token handling.
6. `encode` end to end.
7. `decode` end to end.
8. Oracle diff harness and test runner.

Beads 2, 3, and 8 are independent and can run in parallel immediately. Bead 4 depends on 1. Bead 6 depends on 1 through 5. This dependency shape is exactly what makes the board interesting: parallel beads mean parallel agents lighting up.

---

## 5. The self-improvement loop

The loop, one cycle:
1. Planner v(n) produces a bead graph for "port the BPE tokenizer to Rust."
2. Coordinator routes ready beads, workers execute and close them over Agent Mail and Beads.
3. Validator runs the oracle diff, logs a Weave Evaluation (accuracy, pass@1, efficiency).
4. Improver agent reads the Weave eval results through the W&B MCP server (which is explicitly built to "inspect and auto-improve based on your runs, traces and evals") and rewrites `planner/SKILL.md` to fix the specific gaps it sees (for example, "decomposition skipped unicode normalization, add an explicit bead for byte-level edge cases").
5. New planner v(n+1). Repeat.

**Run it autonomously overnight.** This is the "agents that work while we go play with robot dogs" move and it doubles as demo prep. Capture planner v1 through v5 (or more), the climbing correctness curve, and the populated Redis leaderboard. Also let the tokenizer reach a high correctness so the live diff shows a strong number.

**Do not bet the live demo on convergence on stage.** Show the pre-baked v1 to v5 curve. Trigger one live cycle only if it is fast and reliable.

---

## 6. Weave instrumentation

- `pip install weave`, then `import weave; weave.init("glassbox")`.
- Decorate the planner, each worker run, the validator, and the improver with `@weave.op()` so Weave shows sessions, turns, steps, and sub-agents as first-class objects. This is the new agent-native Weave tracing, and it is the single strongest Best-Use-of-Weave move with two W&B judges in the room.
- Define a Weave Evaluation whose scorer is the oracle diff. Each planner version is a row. Build a Weave leaderboard ranked by accuracy, then efficiency.
- Use the W&B MCP server as the improver's backbone (see Section 14 for the Claude Code config). Use `npx add-skill altryne/weavify-skill` to wire Weave into the project fast.
- The pitch beat: Weave is not just logging. Because there is a hard oracle, Weave is the thing that shows which sub-agent actually moved correctness, and whether a plan passed cleanly or thrashed. That is the answer to "are these agents any good."

---

## 7. The command center (tldraw)

`pnpm add tldraw`, `import { Tldraw } from "tldraw"` and `import "tldraw/tldraw.css"`. Drive everything programmatically; the board is a visualization, not a drawing tool.

**Custom shapes** (extend `ShapeUtil` / `BaseBoxShapeUtil`, register via the `shapeUtils` prop):
- `AgentShape`: a lane card per agent (planner, coordinator, workers, validator) with a status light (idle, working, done, failed).
- `BeadShape`: a small node carrying id, title, and state, rendered on the chain.
- Use built-in `arrow`/`line` shapes for the chain and the routing edges.

**Animation, driven by the Redis event stream** (use `onMount(editor)`, `editor.createShape`, `editor.updateShape`, `editor.deleteShapes`, `createShapeId`, and `editor.store.listen`):
- `bead_created` -> add a BeadShape to the backlog chain.
- `bead_claimed` -> animate the bead traveling to the claiming AgentShape, flip the agent light to working.
- `plan_gap_found` / `bead_injected` -> the planner drops a new BeadShape into the chain mid-run (a great visible moment).
- `bead_done` -> bead flows from worker to validator.
- `validation_passed` / `validation_failed` -> bead turns green or bounces back as a new bead.
- `planner_rewrite` -> bump the planner version badge and update the correctness curve.

Make the coordination visible. A bead getting pulled, the planner spotting a gap and injecting a bead, the coordinator routing by dependency, the validator bouncing a failure: that visible behavior is literally the harness-sophistication criterion.

There is a community tldraw agent skill (`comeonoliver-skillshub-tldraw`) with programmatic-canvas examples if useful.

---

## 8. CopilotKit chat + generative UI

`pnpm add @copilotkit/react-core @copilotkit/react-ui`, import `@copilotkit/react-ui/styles.css`.

- Wrap the app in `<CopilotKit runtimeUrl="/api/copilotkit">`. Stand up the backend with `CopilotRuntime` in a Next.js route.
- Use `CopilotSidebar` or `CopilotChat` as the command bar. The operator types the goal here ("port the BPE tokenizer to Rust") to launch a run.
- Use `useCopilotAction({ name, render: ({ args }) => <Chart .../> })` for generative UI: render the Weave correctness curve and the planner-version leaderboard as React components the agent surfaces in chat.
- Connect the swarm backend to CopilotKit over AG-UI by registering it as an `HttpAgent` in the runtime, so streaming and shared state work without custom plumbing. List AG-UI (and MCP) as the protocols used in the submission.

---

## 9. Redis (the integration contract)

Redis is the seam between swarm and cockpit. Define this on hour one and both sides build against it.

- **Event stream:** a Redis Stream `glassbox:events`. Every agent appends events. Event schema:
  ```json
  { "ts": 0, "type": "bead_claimed", "run_id": "r1", "planner_version": 3,
    "agent": "worker-2", "bead_id": "bd-a1b2", "title": "BPE merge loop",
    "payload": {} }
  ```
  Event types: `run_started`, `plan_started`, `bead_created`, `bead_claimed`, `bead_done`, `plan_gap_found`, `bead_injected`, `validation_passed`, `validation_failed`, `planner_rewrite`, `run_finished`.
- **Live bead state:** a poller mirrors `bd ready --json` and `bd list --json` into Redis so the board's bead list is always accurate even if an event is missed.
- **Leaderboard:** a sorted set `glassbox:planner_scores` keyed by planner version, scored by accuracy (tie-break on efficiency), drives the curve and the leaderboard.
- **Transport to frontend:** a thin Next.js route tails `glassbox:events` and pushes over SSE or WebSocket to the tldraw board.

---

## 10. Phases and timeline

Times assume Sat 11:15am start. The overnight phase is autonomous.

### Phase 0: Substrate and proof of life (Sat 11:15am to 1:00pm)
Goal: prove the borrowed machine runs end to end on a trivial task before building anything fancy.
- New public repo, pnpm monorepo (`apps/web`, `agents/`, `tokenizer-rs/`, `harness/`).
- Grab credits (Section 14), set `WANDB_API_KEY`, `weave.init`, confirm a hello-world `@weave.op()` trace appears.
- Install Beads (`bd init --quiet`), Agent Mail, and the Redis instance. Wire the W&B MCP server into Claude Code.
- Smoke test: one planner pass creates 2 or 3 beads, one worker claims and closes one, an event lands in `glassbox:events`.
- **Done when:** a trace is in Weave, a bead moves through bd, and an event is in Redis.

### Phase 1: Oracle harness + tokenizer skeleton (Sat 1:00pm to 4:00pm)
Goal: the scoreboard exists and the swarm has a real target.
- Generate the reference fixtures (corpus + canonical token IDs from tiktoken or HF).
- Rust crate skeleton (`tokenizer-rs`) with `encode`/`decode` stubs and a CLI that reads stdin and prints token IDs.
- Diff harness: run Rust over the corpus, compare to fixtures, emit accuracy + pass@1 + metrics as a Weave Evaluation.
- Planner produces the 8-bead decomposition for the tokenizer.
- **Done when:** the harness runs, reports a (low) accuracy number, and logs it to Weave; the bead graph exists.

### Phase 2: Weave eval depth + Redis wiring (Sat 4:00pm to 6:30pm)
Goal: real grading and the live seam.
- Wrap planner, workers, validator, improver as `@weave.op()`; confirm sessions/sub-agents render.
- Finalize the Evaluation scorer and the planner-version leaderboard.
- Implement the event tap (agents -> Redis Stream) and the `bd` poller.
- Implement the Next.js SSE/WebSocket route tailing Redis.
- **Done when:** running the swarm visibly produces a stream of events at the frontend endpoint, and a Weave leaderboard exists.

### Phase 3: The cockpit (Sat 6:30pm to 9:00pm, through dinner)
Goal: the glass box reflects real swarm activity.
- tldraw board with AgentShape lanes and BeadShape nodes.
- Subscribe to the event stream and animate: bead created, claimed, traveling, done, validated, gap injected, version bump.
- **Done when:** launching a run makes the board move on its own, showing the coordination.

### Phase 4 (autonomous, overnight): Run the self-improvement loop
- Kick off the loop on the tokenizer and let it run unattended.
- Capture planner v1 through v5+, the climbing correctness curve, the populated leaderboard, and a high final tokenizer correctness.
- Screen-record one clean board run as a backup demo video.

### Phase 5: Chat, polish, and demo prep (Sun 9:00am to 12:30pm)
- CopilotKit command bar to launch a goal; generative-UI charts for the curve and leaderboard.
- Polish the board (labels, colors, the version badge).
- Rehearse the strict 3 minutes against a timer. Build the one slide. Record the under-2-minute demo video. Write the submission (Section 12). Final commits.
- **Buffer 12:30 to 1:00pm and submit by 1:00pm.**

---

## 11. Demo script (3 minutes, strictly enforced, heavy on demo, one slide max)

- **0:00 to 0:20 (one slide).** "Agent swarms are black boxes. Glassbox is the glass cockpit: watch a self-improving swarm build real code, graded live against ground truth." Name the stack in one breath: Agent Mail and Beads for coordination, Weave for grading and self-improvement, Redis for the live bus, CopilotKit and tldraw for the cockpit.
- **0:20 to 1:30 (live board).** Type the goal into chat: "port the BPE tokenizer to Rust." Planner decomposes, beads appear on the chain. Coordinator routes ready beads, worker lanes light up, a bead travels and comes off the list. Planner spots a gap and injects a bead live. Line: "this is Agent Mail plus Beads under the hood, but now you can see it."
- **1:30 to 2:20 (the oracle and Weave).** Validator runs the diff, the correctness number is real (exact token-ID match vs the reference). Show the Weave-graded correctness curve climbing across planner versions. Line: "Weave is not just logging. With a hard oracle it tells us which sub-agent moved correctness, and which plan passed cleanly versus thrashed."
- **2:20 to 2:50 (the punchline).** The planner rewrote its own skill from the Weave evals, autonomously overnight. Show v1 versus v5 briefly, or the curve. Trigger one live cycle only if reliable.
- **2:50 to 3:00 (close).** "Orchestration you can see, graded against truth, that improves itself. Built this weekend, and it connects to a larger Godot-to-Rust port."

**Q&A prep.** Gaming: trajectory scoring plus pass@1, read-only sandboxed tests, Weave watches for tampering. Reused vs built: fresh repo this weekend; Beads, Agent Mail, tldraw, CopilotKit are dependencies; the planner loop, oracle harness, and cockpit are new; Patina is referenced context only.

---

## 12. Submission checklist (Cerebral Valley platform, link posted Sun morning)

- Unique team name, all team members with emails and socials.
- Public GitHub repo link.
- Demo video under 2 minutes (or explanatory images).
- X and/or LinkedIn handles for tagging.
- A 2 to 3 sentence summary of what you built.
- What it does and what it is useful for.
- How it is built: name the orchestration protocols (MCP, AG-UI), the agent frameworks, and any RL environments. State clearly that Beads, Agent Mail, tldraw, and CopilotKit are third-party, and that the planner loop, oracle harness, and cockpit were built this weekend.
- A per-sponsor description (critical for sponsor and grand prizes): Weave (tracing + Evaluation + self-improvement backbone via the W&B MCP server), Redis (event stream + planner-version leaderboard via sorted sets), CopilotKit (chat command bar + generative UI over AG-UI). Mention OpenAI/Cursor credits if used.
- Include the Weave project link.
- Have Zoom installed or the web share link ready.
- Post to social immediately after, even janky.

---

## 13. Cut-lines (MoSCoW) and risk register

**MUST (credibility + wow, non-negotiable):**
- Substrate runs end to end on a trivial task (Phase 0).
- Oracle-graded loop with Weave showing a real, climbing correctness number.
- tldraw board visibly showing coordination, driven by real swarm events.

**SHOULD:** pre-baked v1 to v5 self-improvement curve; CopilotKit chat to launch goals; Redis leaderboard.

**COULD:** a live self-improvement cycle on stage; generative-UI charts; the v1 vs v5 prompt diff view.

**WON'T (cut now to protect the timeline):** multiplayer board sync (skip entirely, it is sync infra you do not need); multiple target packages; full CommonMark; auth; persistence beyond the demo.

**Fallbacks:**
- Live launch flaky: play the pre-recorded clean board run.
- Rust build slow on stage: pre-build, demo against a warm binary.
- Weave UI finicky live: screenshot the leaderboard, show the curve from Redis.
- Loop did not converge overnight: show the best run captured, the curve still tells the story.

---

## 14. Setup quick start

**Venue:** WIFI `W&B Guest`, password `Gumption`.

**Credits (do this first, find Alex or Anna, people in yellow jackets):**
- $50 W&B Weave Inference: fill the form, then collect.
- $50 OpenAI credits and $100 Cursor credits: collect after the form.
- W&B Inference getting started: `wandb.me/inference`.

**Weave:**
```bash
pip install weave        # or: uv pip install weave
export WANDB_API_KEY=...  # from your wandb account
```
```python
import weave
weave.init("glassbox")
# decorate planner/worker/validator/improver with @weave.op()
```

**W&B MCP server (the improver's backbone), Claude Code:**
```bash
claude mcp add --transport http wandb https://mcp.withwandb.com/mcp \
  --header "Authorization: Bearer <your-wandb-api-key>"
```
Weavify skill: `npx add-skill altryne/weavify-skill`

**Beads:**
```bash
brew install beads        # or the curl install script
bd init --quiet
pip install beads-mcp     # MCP server for agents
# usage the agents rely on: bd create "..." -t task -p 1 --deps "blocks:bd-1"
#                            bd ready --json ; bd update <id> --claim ; bd close <id>
```

**Agent Mail (Dicklesworthstone):**
```bash
curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/mcp_agent_mail/main/scripts/install.sh" | bash -s -- --yes
# project_key is the absolute path of the repo; one server handles multiple projects
```

**Frontend:**
```bash
pnpm create next-app apps/web --ts --tailwind
pnpm add tldraw @copilotkit/react-core @copilotkit/react-ui
# add shadcn/ui as desired
```

**Redis:** run locally (Docker or brew), create the `glassbox:events` stream and `glassbox:planner_scores` sorted set on first write. Ask the Redis sponsor engineer (table sign) for help with Streams and vector features if you extend.

**Onsite help:** every sponsor has an engineer at a table. Use them, they are faster with their own tools than anyone.

---

### The bet in one paragraph
Build the glass box. Point your own self-improving swarm at porting a BPE tokenizer to Rust, grade it against an exact oracle so Weave finally has ground truth to measure, and make every bead, agent, and gap visible on a tldraw board with a CopilotKit command bar. Run the loop overnight so the correctness curve climbs while you sleep. The target is small on purpose. The machine and the cockpit are the win.
