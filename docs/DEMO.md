# Glassbox demo script (3 minutes, heavy on the board)

## Setup (before you present)

```bash
# one time
cp .env.example .env        # team keys already set
pnpm install && uv sync

# three terminals (or pnpm dev if you wire a runner)
pnpm redis                                  # local Redis :6379
GLASSBOX_PACE_MS=600 pnpm backend           # swarm + AG-UI server :8100 (paced so beads are visible)
pnpm web                                     # cockpit :3100
```

Open `http://localhost:3100/hackathon` (the simulated cockpit; `/` now opens the swarm command center). Use the cockpit Reset button (it clears the per-task
leaderboards and the board) right before you go on. Workers author with the model by
default; for a fast, fully reliable live board set `GLASSBOX_WORKER_LLM=0` (the
deterministic reference path) and show a captured genuine run for the authoring beat.

For the cleanest visual, run the cockpit in production mode so Next's dev overlay does
not show:

```bash
pnpm --filter web build && pnpm --filter web start   # cockpit :3100, no dev overlay
```

Have the Weave project open in a tab: https://wandb.ai/whitely-white-elk-llc/glassbox/weave

## Script

**0:00 to 0:20 (one slide).** "Agent swarms are black boxes. Glassbox is the glass
cockpit: watch a self-improving swarm genuinely write code, graded live against a
checkable oracle, and do it on more than one problem." Stack in one breath: Agent Mail
and Beads for coordination, Weave for grading and self-improvement, Redis for the live
bus, CopilotKit and tldraw for the cockpit.

**0:20 to 1:10 (live board, tokenizer).** Task = tokenizer. Type or click Launch. The
planner decomposes the goal, beads appear on the chain, the coordinator routes ready
beads, worker lanes light up amber, a bead travels to a worker and on to the
validator. Line: "the workers are writing the actual Rust pretokenizer here, and the
validator builds it and diffs the token IDs against tiktoken. No gating, no hardcoded
number." Click "Run live (inject)": the planner spots a missing group, injects a bead
live, and the accuracy jumps.

**1:10 to 1:55 (generality, the textkit).** Switch the task to "textkit" and Launch. "Same
swarm, zero code changed, a completely different problem: a Python library graded by
pytest." The board animates the same way; the curve climbs as the workers write
modules and pytest passes more tests (0.52 to 1.00). Line: "the target is a prop. The
machine is the point, and it generalizes to anything with a checkable evaluator."

**1:55 to 2:40 (Weave and self-improvement).** Open Weave: each run is a nested
session, and you can see which sub-agent wrote which code and whether a plan passed
cleanly or thrashed. Then show the planner skill diff (the GET /skill viewer, or
`history/v1` vs the latest): each revision names the group that failed most in the real
eval and adds a bead to cover it. The curve climbed from a low floor to 1.00 on its
own, on both tasks. Line: "Weave is not just logging. With a hard oracle it tells us
which sub-agent actually moved correctness."

**2:40 to 3:00 (close).** "Orchestration you can see, agents that genuinely write code,
graded against truth, that improves itself and generalizes. Built this weekend, and it
connects to a larger Godot-to-Rust port."

## The real swarm on /swarm (the live-landing demo)

The strongest live beat as of 2026-06-12: `/swarm` spawns REAL Claude Code sessions in tmux
and the cockpit detects the loop shape's stop condition itself. Two proven landings:

- **Sweep** (8 minutes wall): the 4-file sandbox goal drains `4/4` and the board shows
  `backlog drained ✓` then auto teardown ("cleaned up 6 session(s), logs saved").
- **Climb** (12 to 20 minutes wall): the tokenizer perf goal. The edge gauge climbs
  `269 → 141 ms`, the LEADERBOARD rail tracks every version with its Weave Evaluation link,
  then the plateau lands the swarm by itself.

Pre-flight, goals verbatim, shot list, and honesty notes live in `docs/VIDEO_SCRIPT.md`
under "The real-swarm cut". Short version: services up, hit `clear` in the /swarm header,
reset the tokenizer leaderboard + post the baseline eval, workers 2, pick the shape, paste
the goal, `+ real swarm`, and let it land. `clean up` and `clear` are safe at any moment.

## Backup buttons (if the chat is flaky)

The board has direct controls per task: "Launch run" (single full plan), "Run climb"
(the genuine self-improvement loop), and "Run live (inject)" (the spot-a-gap beat).
Each maps to POST /api/run, /api/loop, /api/live with the selected task.

## Q and A prep

- Do the agents really write the code? Yes. The worker prompts W&B Inference with the
  current source and the validator's real failing cases, writes the edit, builds it,
  and keeps it only if the score genuinely improves; otherwise it falls back to a
  vetted reference (logged). The score always comes from the real built artifact.
- Gaming: exact token-ID match / real pytest, read-only fixtures and tests, Weave
  traces watched for tampering. There is no gating: an incomplete tokenizer genuinely
  fails inputs, so the number is never masked.
- Generality: a task is `{goal, workspace, checkable evaluator}`. We ship two
  (tokenizer via exact oracle, textkit via pytest) and the same swarm runs both. The
  honest limit is the evaluator: any task with tests or a reference to diff.
- Reused versus built: fresh repo this weekend. Beads (`br`), Agent Mail, tldraw,
  CopilotKit, recharts, tiktoken, and pytest are third-party; the swarm, the Task +
  Evaluator abstraction, both tasks, the cockpit, and the self-improvement loop are
  new. Patina is referenced context only, not reused.

## Fallbacks

- Live launch flaky: play a pre-recorded clean board run, or use the board buttons.
- LLM-authoring slow or flaky on stage: set `GLASSBOX_WORKER_LLM=0` (deterministic
  reference path, still a real build + real grade) and show a captured genuine run for
  the authoring beat.
- Rust build slow: pre-build (cargo build --release), demo against the warm binary.
- Weave UI finicky: show the curve from the cockpit (it reads Redis) and the
  per-task SKILL snapshots.
