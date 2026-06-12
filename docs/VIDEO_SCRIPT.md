# Glassbox submission video script (under 2 minutes)

First person, for Jonathan to narrate. Voice rule: no em dashes (periods, commas,
parentheses only). Target runtime 1:50. Talk OVER the board animation, do not wait for
it, and speed up any slow stretch 1.5x to 2x in editing to stay under 2:00.

## Before you record

```bash
# clean, production cockpit (no Next dev overlay)
pnpm redis
GLASSBOX_PACE_MS=600 pnpm backend
pnpm --filter web build && pnpm --filter web start   # cockpit :3100
```

- Make sure the curve is populated so the climb is on screen instantly:
  `uv run python -m scripts.seed_curve --load --task tokenizer` (restores the real
  v1 to v6, 0.171 to 1.000 climb). Re-run after any Redis restart.
- Hit the cockpit **Reset** before the live beat so the board starts clean.
- For a fast, fully reliable board, set `GLASSBOX_WORKER_LLM=0` (still a real build and
  real grade), or record one genuine model-authored run and cut to it for the writing beat.
- Have the Weave project open in a second tab:
  https://wandb.ai/whitely-white-elk-llc/glassbox/weave
- Record screen and voice separately if you can. A clean voiceover beats live umms.

## The script

### 1. Intro and hook  (0:00 to 0:18)
**On screen:** you on camera, or the title slide / idle cockpit.
**Say:**
> Hi, I'm Jonathan Hawkins from White Elk Studios. Agent swarms are black boxes. You
> point a pile of agents at a problem and hope. Glassbox is the glass cockpit that lets
> you watch a self-improving swarm write real code, graded live against ground truth.

### 2. How I broke it down  (0:18 to 0:54)
**On screen:** the cockpit lanes (planner, coordinator, workers, validator, improver), or
the architecture slide in the deck.
**Say:**
> Here's how I broke it down. Five agents coordinate over Agent Mail and Beads. A
> planner decomposes the goal into a dependency graph of beads. A coordinator routes the
> ready ones. Worker agents write the actual Rust. A validator grades it. And an improver
> rewrites the planner from what each run learns. The target is a BPE tokenizer, because
> a tokenizer gives me an exact, ungameable oracle: does my Rust produce the same token
> IDs as the reference, byte for byte. The target is small on purpose. The product is the
> swarm and the cockpit.

### 3. Watch it run  (0:54 to 1:20)
**On screen:** type the goal into the CopilotKit command bar (or click **Launch run**).
Let the board animate: beads appear, coordinator routes, worker lanes go amber, a bead
travels to the validator.
**Say:**
> Watch it run. I type the goal into the CopilotKit command bar. The planner lays the
> beads on the tldraw canvas, the coordinator routes the ready ones, and the worker lanes
> light up as they write each piece with W&B Inference. Everything moving on this board is
> a live Redis event stream. A finished bead travels to the validator, which builds the
> Rust and diffs the token IDs against tiktoken. That number is real: exact match, no
> gating, no hardcoded answers.

### 4. The climb (the point)  (1:20 to 1:48)
**On screen:** the correctness curve climbing v1 to v6 (optionally ask the copilot "show
the correctness curve" so it renders as CopilotKit generative UI inside the chat thread).
Cut to the Weave tab (nested sessions), then to the skill diff (`history/v1` vs the
latest, or the skill viewer).
**Say:**
> Now the part I care about. Every run is graded by Weave against that oracle. So Weave
> is not just logging. With a hard oracle, it shows which sub-agent actually moved
> correctness. The improver reads the real failures and rewrites the planner's own skill
> to close the gap. That is this curve. It climbs from seventeen percent to one hundred,
> version over version, and it rewrote itself to get there, overnight.

### 5. Close  (1:48 to 1:58)
**On screen:** back to the full cockpit, or you on camera.
**Say:**
> Orchestration you can see, graded against truth, that improves itself. Built this
> weekend, That's Glassbox.

## Optional generality beat (swap in, do not add)

If you want to show it is not baked to the tokenizer, drop one of these into beat 3 and
trim beat 2 by a sentence to stay under time. The bring-your-own-repo version is the
stronger "have you seen this before" moment, so prefer it if the run is reliable.

**Bring your own repo (the strong proof), ~12 seconds.** Click **+ repo**, point it at a
repo and a test command, Create, then Run climb:
> And it is not baked to the tokenizer. I hand the same swarm a real repo and its test
> suite. It discovers what is failing, fixes it with the model, no safety net, and the
> pass-rate climbs. The score is whatever the swarm actually earned.

**Textkit (the simple swap), ~8 seconds.** Switch the task to **textkit**, click Launch:
> And the same swarm runs a completely different problem, a Python library graded by
> pytest, with zero code changed.

## If you run long

- Cut "from what each run learns" and "The target is small on purpose" in beat 2.
- Tighten the intro to: "Agent swarms are black boxes. Glassbox is the glass cockpit
  that lets you watch a self-improving swarm write real code, graded live against ground
  truth. I'm Jonathan Hawkins."
- Speed the board-animation footage 2x under the narration.

## The real-swarm cut (alternate main act, on /swarm)

Built and live-proven on 2026-06-12: `/swarm` spawns REAL Claude Code sessions in tmux (not
the simulated backend), watches their actual coordination mail and task lists, and LANDS the
run itself when the loop shape's stop condition is met. Two landings are proven on camera-ready
paths: Sweep (backlog drained, the 4-file sandbox goal) and Climb (the tokenizer got genuinely
faster, 269 to 141 ms, then plateaued and the cockpit tore the swarm down by itself). If you
want one "have you seen this before" moment, this is it: nobody expects the cockpit to know
when the swarm is done.

### Pre-flight (5 minutes)

1. Bridge (7777), agent mail (8765), Redis, cockpit (3100) all up. Open `/swarm`, pick the
   conductor, hit `clear` in the header (wipes board + activity + mail floor, /clears the
   conductor, and re-binds it through the session-id roll automatically).
2. Fresh leaderboard, then post the baseline so v1 is on the rail from the first frame:

   ```bash
   redis-cli del glassbox:planner_scores:tokenizer glassbox:planner_meta:tokenizer
   uv run python -m harness.eval --task tokenizer --planner-version 1
   ```

3. Header: workers `2`, shape `Climb`. Rail open, ACTIVITY and LEADERBOARD expanded.
4. Goal text, verbatim (this exact goal produced the 269 to 141 ms landing):

   > Make the Rust BPE tokenizer in tokenizer-rs/ FASTER. Edit ONLY tokenizer-rs/. Baseline is
   > already posted: accuracy 1.000 (217/217), wall_ms 269. After EACH optimization, run from
   > the repo root: uv run python -m harness.eval --task tokenizer --planner-version N (start N
   > at 2 and increment it every eval run). accuracy must stay 1.000, revert any change that
   > drops it. Drive wall_ms DOWN (faster hashing, fewer allocations, less IO). Run an eval
   > after every change, do not batch. When you cannot find another win, mail tasks done with
   > the best wall_ms and stop.

5. `git status` clean (the tree staying clean through the run is a talking point).
6. Wall time is 12 to 20 minutes. Record it all, cut the planning stretch (about 2 minutes)
   and each optimization round (3 to 5 minutes); a small clock overlay keeps the cut honest.

### Beats (cut target 60 to 80 seconds inside the video)

**R1. Spawn (5s).** Click `+ real swarm`. Nodes light up one by one.
> One click spawns six real Claude Code sessions in tmux. Planner, coordinator, two workers,
> validator, improver. Each role gets its own model and effort level.

**R2. Plan and assign (8s).** Backlog beads appear, then fly to the worker docks; mail badges
count up.
> The planner writes a real task list, and the coordinator assigns work over agent mail. The
> board is reading their actual messages. This is their coordination, not an animation.

**R3. The climb (10s).** The return edge gauge flips `269 → 174 ms`, then `269 → 141 ms`; the
LEADERBOARD rail's best flag moves; click `weave ↗` on the best row and the W&B Evaluation
opens.
> The goal: make my Rust tokenizer faster without breaking the oracle. Every change is graded
> by the harness, accuracy stays at one hundred percent, and every grade is a real Weave
> Evaluation, deep-linked from the board.

**R4. The landing (10s).** Improvements stop. The green chip `plateau: best kept ✓` appears,
then the header note "cleaned up 6 session(s), logs saved" as the nodes go dark.
> And here is the part I care about. The cockpit detects the stop condition itself. Three
> minutes with no improvement means plateau, so it lands the swarm: kills the sessions, saves
> the logs, keeps the best build. The loop knew when to stop.

**R5. Reset (3s).** Click `clear`; the board wipes to zero.
> One click, clean cockpit, ready for the next run.

### Sweep b-roll (10s, optional, for beat R2's "task flow")

Shape `Sweep`, goal verbatim:

> Create exactly 4 text files in /tmp/glassbox-sandbox/: land.txt, climb.txt, sweep.txt,
> race.txt, each holding one sentence describing that loop shape. Make one task per file with
> TaskCreate. Work ONLY in /tmp/glassbox-sandbox. Stop when all 4 files exist.

Pre-flight `rm -f /tmp/glassbox-sandbox/*.txt`. Money shots: the drain gauge counting
`drained 2/4` then `4/4`, the `backlog drained ✓` chip, the auto teardown. About 8 minutes
wall time, the fastest full landing to record.

### Honesty notes for the edit

- wall_ms on a cold run jitters (vocab JSON loading dominates); the gauge reads min-so-far so
  noise never moves it backward. Narrate the leaderboard's best row, not one cold number.
- The warm encode path after the swarm's optimizations measures about 4 ms for all 217
  fixtures; say "the eval's wall clock" for the 269 to 141 number, not "the tokenizer is 2x".
- Safe on camera at any moment: `clean up` kills the swarm, `clear` resets the board, and
  neither touches the repo.

## 30-second social cut (optional, for the post)

> Agent swarms are black boxes. Glassbox is a glass cockpit over a self-improving swarm
> that writes real Rust, graded live against a hard oracle: exact token-ID match versus
> tiktoken. You watch a planner decompose the work, workers write the code, a validator
> grade it, and the planner rewrite its own skill until correctness climbs from seventeen
> percent to one hundred. Built this weekend at WeaveHacks. The target is a prop. The
> swarm and the cockpit are the point.
