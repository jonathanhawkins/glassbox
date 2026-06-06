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

Open `http://localhost:3100`. Reset to a clean board right before you go on:

```bash
redis-cli del glassbox:events glassbox:planner_scores glassbox:beads
for k in $(redis-cli keys 'glassbox:run:*'); do redis-cli del "$k"; done
```

For the cleanest visual, run the cockpit in production mode so Next's dev overlay
does not show. The CopilotKit chat logs one non-fatal AG-UI warning ("Cannot send
RUN_FINISHED while tool calls are still active") from an upstream 1.59.5 lifecycle
quirk; it is harmless and the launch still fires (the on-board buttons are an
independent fallback).

```bash
pnpm --filter web build && pnpm --filter web start   # cockpit :3100, no dev overlay
```

Have the Weave project open in a tab: https://wandb.ai/whitely-white-elk-llc/glassbox/weave

## Script

**0:00 to 0:20 (one slide).** "Agent swarms are black boxes. Glassbox is the glass
cockpit: watch a self-improving swarm build real code, graded live against ground
truth." Stack in one breath: Agent Mail and Beads for coordination, Weave for
grading and self-improvement, Redis for the live bus, CopilotKit and tldraw for
the cockpit.

**0:20 to 1:30 (live board).** In the CopilotKit command bar type:
"port the BPE tokenizer to Rust." The planner decomposes the goal, beads appear on
the chain, the coordinator routes ready beads, worker lanes light up amber, a bead
travels to a worker and on to the validator. Line: "this is Agent Mail plus Beads
under the hood, but now you can see it." Then click "Run live (inject)": the
planner spots a missing category, injects a bead live, and the accuracy jumps.

**1:30 to 2:20 (the oracle and Weave).** The validator runs the diff: the
correctness number is real, exact token-ID match versus tiktoken. Show the
Weave-graded correctness curve climbing across planner versions (v1 0.14 to v7
1.00). Line: "Weave is not just logging. With a hard oracle it tells us which
sub-agent moved correctness, and which plan passed cleanly versus thrashed."

**2:20 to 2:50 (the punchline).** The planner rewrote its own skill from the Weave
evals, autonomously. Show the v1 versus v7 `SKILL.md` diff (the GET /skill view or
`agents/planner/history/v1.md` vs `v7.md`): each revision names the failing input
category and the prior accuracy, and adds a bead to cover it. The curve climbed
0.14 to 1.00 on its own.

**2:50 to 3:00 (close).** "Orchestration you can see, graded against truth, that
improves itself. Built this weekend, and it connects to a larger Godot-to-Rust
port."

## Backup buttons (if the chat is flaky)

The board has direct controls: "Launch run" (single full plan, 100%), "Run climb
x5/x7" (the genuine self-improvement loop), and "Run live (inject)" (the
spot-a-gap beat). Each maps to POST /api/run, /api/loop, /api/live.

## Q and A prep

- Gaming: pass@1 plus exact token-ID match, read-only fixtures, Weave traces watched
  for tampering. The tokenizer genuinely fails uncovered input categories, so the
  number is not masked.
- Reused versus built: fresh repo this weekend. Beads (`br`), Agent Mail, tldraw,
  CopilotKit, recharts, and tiktoken are third-party dependencies; the planner loop,
  oracle harness, cockpit, and self-improvement loop are new. Patina is referenced
  context only, not reused.

## Fallbacks

- Live launch flaky: play a pre-recorded clean board run, or use the board buttons.
- Rust build slow: pre-build (cargo build --release), demo against the warm binary.
- Weave UI finicky: show the curve from the cockpit (it reads Redis) and the
  `agents/planner/history/` SKILL snapshots.
