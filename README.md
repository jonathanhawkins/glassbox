# Glassbox

**A glass cockpit for swarms of real coding agents. Point it at live Claude Code,
Codex, and Gemini sessions, choose one of 8 loop shapes, and watch the swarm decompose
the goal, hand each piece to a sub-agent, and verify the work for real, every move
animated on a tldraw board.**

The swarm is a fixed cast of roles (planner, coordinator, workers, validator,
improver), and it runs two ways, same roles and same loop shapes either way. As **live
sessions** you supervise in the command center: each role is a real coding-agent
session in its own tmux window, driven through voxherd-bridge, coordinating over Agent
Mail and a shared task list, genuinely authoring the code. Or as a **graded backend**
that wires one loop to a hard oracle, so the score is a fact, not a claim.

A loop is that swarm engine plus a stop condition. The engine never changes (decompose,
dispatch, verify); the shape is only when to quit, so each of the 8 is named for its
motion. Land stops when the goal is done, Climb when a metric stops improving, Sweep
when a backlog drains, Race when a judge picks a winner. You pick a shape in the command
center or deep-link it with `?shape=`, and the board redraws the loop's return edge to
match.

The graded loop is the proof the rest do real work: a Climb that ports a BPE tokenizer
to Rust, scored by an exact token-ID diff against tiktoken gpt2 (no gating, no hardcoded
numbers). The workers write each edit with W&B Inference, the artifact is built and
scored, and the improver reads the real eval failures back from Weave and rewrites the
planner skill, so accuracy climbs across versions (tokenizer ~0.17 to 1.00, the textkit
task 0.52 to 1.00) with zero swarm code changed between tasks.

![cockpit](docs/board-verify.png)

## The swarm

The cast is fixed and declared in the contract (`contract/glassbox.contract.json`, under
`agents`): planner, coordinator, worker-1..4, validator, improver. Each runs as its own
session and earns its place:

- **Planner** decomposes the goal into a Beads task graph within the first minute, then
  mails the coordinator the plan, and re-plans whenever a gap surfaces.
- **Coordinator** routes, it does not implement: it assigns each ready task to a free
  worker and keeps the pipeline moving.
- **Workers** claim a task, author the code, build it, and ask the validator to verify.
- **Validator** builds and runs the task's checkable evaluator and reports the real score.
- **Improver** reads which groups failed and turns each into a fix task, closing the loop.

The channels are real, not mocked. Agent Mail (MCP) carries the messages and file leases,
a shared task list tracks who holds what, and a Redis event stream feeds the board, so
every claim, handoff, and verify is visible as it happens.

### How a loop drives a session

The loop kernel (`apps/web/src/lib/voxherd/loop.ts`) treats each worker as a real
terminal, not an API. One round is: send the step into the session, wait for the
bridge's real `agent_event:stop` (the agent's turn is genuinely finished), scan the
output for a `LOOP_DONE` sentinel (the agent self-reports and verifies), then continue or
stop. The stop rule is the loop shape; a round budget and a manual stop are always
available. Nothing advances on a timer, it advances on the agent actually finishing. The
graded backend (`agents/`) runs the same roles as a headless Python loop, with W&B
Inference standing in for the interactive turn and the oracle score for the sentinel.

## Loop shapes

Same swarm engine every time. What differs is the stop condition, so each shape is named
by its motion, a single-syllable verb. The 8 ids are canonical in
`contract/glassbox.contract.json` (`archetypes`), shared by the TS cockpit and the Python
swarm.

| Shape | What it does | Stops |
| --- | --- | --- |
| Land | Drive to a done-state, then stop. | When the goal is verified done. |
| Climb | Push a metric until it stops improving. | When you can no longer beat your best. |
| Hold | Keep an invariant true, repair drift. | Never, repairs whatever drifts. |
| Watch | Ingest a stream, report a digest each round. | Never, reports every round. |
| Burst | Fan out once, synthesize, done. | After one round. |
| Sweep | Drain a finite backlog, wave by wave. | When the backlog is empty. |
| Dig | Discover until the finds run dry. | After two rounds with nothing new. |
| Race | Same goal, competing attempts, one judge. | When the judge picks a winner. |

## Generality

A task is just `{goal, workspace, checkable evaluator}`, and the same swarm runs any of
them. The evaluator is pluggable (`harness/evaluator.py`): the tokenizer grades by an
exact token-ID diff, the `textkit` task grades by its pytest suite, and `+ repo` in the
command center points the same loop at any repo you hand it (a path or git URL plus a
test command). It discovers the failing tests and fixes them with the model and no safety
net, so the score is whatever the swarm actually earned and the source repo is never
mutated. Generality is bounded only by the evaluator: any task with an executable test
suite or a reference to diff.

## Architecture

```
Goal -> Planner decomposes -> Beads graph (br)
  -> Coordinator routes ready beads -> Workers AUTHOR the code (build + self-check)
  -> Validator builds + runs the task's checkable evaluator -> score + a real Weave Evaluation
  -> Improver reads the eval gaps back FROM Weave -> rewrites the planner skill -> v(n+1)
  -> repeat, until the loop's stop condition fires

All agents -> Redis Stream glassbox:events -> SSE -> tldraw board
Per-task planner-version scores -> Redis sorted sets -> the climbing curve
```

| Layer | Tech |
| --- | --- |
| Live sessions | voxherd-bridge over tmux (Claude Code, Codex, Gemini) |
| Coordination | Agent Mail (MCP), Beads (`br`) |
| Observability + eval + self-improvement | W&B Weave + W&B MCP server |
| Event bus + per-task leaderboard | Redis (Streams + sorted sets) |
| Cockpit | Next.js + tldraw + CopilotKit (AG-UI) + recharts |
| Checkable evaluators | exact token-ID diff (tiktoken gpt2); pytest |
| Swarm inference | W&B Inference (openai/gpt-oss-120b et al.), Weave-traced |

## Layout

- `apps/web/` cockpit: swarm command center + tldraw board, port 3100
- `agents/` the graded swarm (planner, coordinator, workers, validator, improver) + FastAPI, port 8100
- `tasks/` the pluggable tasks: `tokenizer/` (Rust) and `textkit/` (Python), each a
  `{goal, workspace, evaluator, skill}` package
- `harness/` the checkable evaluators (the tiktoken oracle + the pytest runner) and fixtures
- `contract/` the integration seam (archetypes, agent roles, events, Redis keys, ports)
- `docs/` the PRD and writeups

## Cockpit views

- `/swarm` the command center (default): the live fleet grouped by project, the loop
  launcher (pick a shape, set per-role model and effort), and the activity log.
- `/board` the tldraw board: the swarm graph, Agent Mail beads on the nodes, and the
  loop's return edge drawn per shape.
- `/fleet` and `/session/<id>`: the full session roster, and a single session console
  that streams a chat into one session.
- `/hackathon` the original graded cockpit: the CopilotKit command bar plus the climbing
  accuracy curve, against the tokenizer and textkit demos.

## Prerequisites

The cockpit's swarm command center (the default view) drives real Claude Code, Codex,
and Gemini sessions, and it reaches them through **voxherd-bridge**, a local daemon that
runs each session inside **tmux**. Both are required for the live fleet and session views
(the graded tokenizer and textkit runs work without them).

**1. Install tmux** (voxherd-bridge runs every agent session in a tmux window):

```bash
brew install tmux          # macOS
# sudo apt install tmux    # Debian/Ubuntu
```

**2. Install voxherd-bridge** (the session daemon the cockpit proxies to):

```bash
git clone https://github.com/jonathanhawkins/voxherd-bridge
cd voxherd-bridge
```

Then run the daemon one of two ways, both serving the same bridge on `:7777`:

**Desktop app (easiest on macOS).** voxherd-bridge ships a SwiftUI menu bar app
(`macos/VoxHerdBridge/`, built with `bash macos/build-app.sh`) that launches and
supervises the daemon, shows session status, and serves a QR code for mobile pairing.
Linux has a GTK4 / Waybar panel and Windows a system-tray app, both beta.

**CLI.** Run the Python bridge directly:

```bash
bash scripts/dev-setup.sh                # creates the venv and installs deps (macOS)
source bridge/.venv/bin/activate
python -m bridge start --tts             # serves :7777, auto-creates the tmux session
```

Either way, leave the bridge running. The cockpit auto-discovers it at
`http://localhost:7777` and reads its auth token from `~/.voxherd/auth_token`. Set
`VOXHERD_BRIDGE_URL` or `VOXHERD_AUTH_TOKEN` only if your bridge runs elsewhere.

## Run

```bash
cp .env.example .env       # team keys already set
pnpm install && uv sync
pnpm redis                                 # local Redis :6379
GLASSBOX_PACE_MS=600 pnpm backend          # graded swarm + server :8100 (pacing optional)
pnpm web                                   # cockpit :3100
```

Open `http://localhost:3100`. You land on the swarm command center (`/swarm`): with
voxherd-bridge running you see your live sessions, group them by project, pick a loop
shape, and launch it on the fleet.

For the graded self-improving loop, open `/hackathon`. Pick a task (tokenizer or textkit)
in the command bar, or click `+ repo` to bring your own (a repo path or git URL plus a
test command). Then Launch run (one full plan), Run climb (the self-improvement loop), or
Run live (the spot-a-gap inject beat). Workers author with the model by default; set
`GLASSBOX_WORKER_LLM=0` for the fast deterministic path on curated tasks
(bring-your-own-repo always uses the model with no fallback).

From the CLI: `uv run python -m agents.run "<goal>" <run-base> <versions> <task>`
(e.g. `... "build textkit" textkit 6 textkit`).

Ports 3100 and 8100 are deliberate (3000/8000 are reserved on this machine).

See `docs/prds/GLASSBOX_PRD.md` for the original plan and `CLAUDE.md` for conventions.
