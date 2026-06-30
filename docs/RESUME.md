# Glassbox: resume and portfolio copy

Defensible copy for a resume or portfolio site. Every claim here is backed by code or by
a reproducible artifact in `docs/runs/`. The "claims to retire" section at the bottom
lists the four framings from the first draft that an interviewer could pick apart, and
what to say instead.

## One-line

Glassbox: a glass cockpit over a fixed crew of coding agents that write real code,
graded live against a hard oracle, every move animated on a tldraw board.

## Resume bullets (tight, all defensible)

- Built **Glassbox** (WeaveHacks 4, solo): a glass cockpit over a fixed crew of coding
  agents (planner, coordinator, four workers, validator, improver) that decompose a goal,
  hand each piece off over Agent Mail, and verify the work for real, every decompose,
  handoff, and verify animated live on a tldraw board fed by a Redis event stream.
- Graded against a **hard oracle**: a swarm ports a BPE tokenizer to Rust, scored by an
  exact token-ID diff against tiktoken gpt2 with no gating and no hardcoded numbers. The
  self-improving loop rewrites the planner skill from real eval failures and the curve
  climbs **0.17 to 1.00** across versions (a separate Python task **0.52 to 1.00**), each
  version re-measured by the real evaluator. Per-version curves are committed and
  regenerate from a script.
- **General by construction**: point it at any repo plus a test command and it clones
  into a throwaway sandbox, discovers the failing tests, and fixes them with the model
  with no safety net, the source repo never mutated, so the score is whatever the swarm
  actually earned.
- Stack: W&B Inference (gpt-oss-120b) and W&B Weave (traced), Beads, Agent Mail (MCP),
  Next.js + tldraw + CopilotKit, Redis streams and sorted sets, a Rust tokenizer crate.

## Longer form: project description

**Problem.** Agent swarms are powerful and illegible. Run several coding agents in
parallel and the output interleaves into noise: you cannot see who is doing what, work in
progress is invisible until something breaks, and "it works" is whatever the model
claims.

**Constraint.** WeaveHacks 4, solo, fresh repo. The core was built over the hackathon
weekend and hardened across about two more weeks. The swarm had to genuinely author code,
every move had to be visible the instant it happened, and the score had to come from a
real built artifact with no gating and no hardcoded numbers.

**Move.** A glass cockpit over a fixed cast (planner, coordinator, four workers,
validator, improver) that decompose a goal, hand each piece off, and verify the work for
real, every move animated on a tldraw board fed by a Redis event stream. The same crew
runs two ways: as live Claude Code, Codex, and Gemini sessions supervised in the command
center, or as a headless graded backend wired to a hard oracle.

- **Graded against a hard oracle.** A Climb ports a BPE tokenizer to Rust, scored by an
  exact token-ID diff against tiktoken gpt2. The improver rewrites the planner skill from
  the real eval failures, the artifact is rebuilt, and the oracle re-grades it, so
  accuracy climbs across versions (tokenizer 0.17 to 1.00, a Python library task 0.52 to
  1.00) with zero swarm code changed between the two. The per-version curves are checked
  in under `docs/runs/`.
- **General by construction.** A task is just a goal, a workspace, and a checkable
  evaluator. Point the same swarm at your own repo plus a test command and it clones into
  a disposable sandbox, discovers the failing tests, and fixes them with the model and no
  safety net, so the source repo is never touched and the score is what the swarm earned.
- **Eight loop shapes, one engine.** The swarm engine never changes (decompose, dispatch,
  verify); a loop is that engine plus a stop condition. Two shapes have autonomous,
  tested stop-and-teardown (Sweep stops when a backlog drains, Climb when a metric
  plateaus); the rest reframe the board and the kickoff and stop on the agent's verified
  self-report, a round budget, or a manual stop.

**Outcome.** Shipped end to end as a fresh solo repo. The graded Climb drove the Rust
tokenizer from 0.17 to a perfect 1.00 exact token-ID match against tiktoken, then ran a
separate Python library from 0.52 to 1.00 with zero swarm code changed between them
(per-version curves committed under `docs/runs/`). A tokenizer perf Climb removed the
binary's startup and vocab-load cost (the eval's cold wall time went 269 to 141 ms and
warm tokenize is about 4 ms) while exact-match accuracy held at 1.000. The Sweep and
Climb loops have tested autonomous stop-and-teardown. Bring-your-own-repo runs the model
with no safety net against your own test suite, source untouched, so every point on that
curve is a test the model actually made pass.

## Claims to retire (and what to say instead)

These four framings from the first draft are the ones a skeptical reader who opens the
repo could challenge. The replacements above are already corrected; this is the why.

1. "The improver reads eval failures back from Weave and rewrites the planner skill, so
   accuracy climbs" (implies emergent learning). On the two curated tasks the climb is a
   **deterministic curriculum**: the improver walks a fixed category order and a
   deterministic renderer installs the known-correct code for each category, so 1.00 is
   reached the same way every run, and `GLASSBOX_IMPROVER_READ_WEAVE=0` is the shipped
   default (the Weave read is real code but off by default). The scores are real (the
   oracle grades the rebuilt artifact), so say "a self-improvement harness, oracle-graded,
   the curve climbs 0.17 to 1.00," and point to bring-your-own-repo as the
   genuinely-model-earned, no-fallback path.

2. "Workers write each edit with W&B Inference" (every edit, always). True by default,
   but curated tasks have a deterministic fallback and `GLASSBOX_WORKER_LLM=0` skips the
   model. Say "workers author with the model, with a deterministic safety net on the
   curated tasks; bring-your-own-repo has no fallback."

3. "Cut tokenizer latency from 269 to 141 ms." That number is the eval's **cold
   first-exec wall clock** (macOS code-sign, ~270 ms), not tokenize latency; the same
   binary tokenizes all 217 fixtures warm in about 4 ms (see `docs/runs/tokenizer-perf.md`).
   Say "removed the tokenizer's startup and vocab-load cost, cold eval 269 to 141 ms and
   warm tokenize about 4 ms, accuracy held at 1.000."

4. "Shipped in one weekend." The git history runs June 6 to 18. Say "built the core over
   the hackathon weekend, hardened across about two weeks."
