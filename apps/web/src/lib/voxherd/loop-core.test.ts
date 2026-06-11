import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStepPrompt, hasDoneToken, DONE_TOKEN } from "./loop-core.ts";
import type { Archetype } from "@/lib/fleet/archetypes";

// A stand-in archetype: its kickoff echoes a recognizable marker + the goal so we can
// prove round 1 uses it verbatim while round>1 does not. name is what the suffix names.
const FAKE: Archetype = {
  id: "test-shape",
  name: "Land",
  tagline: "",
  whenToUse: "",
  stop: "",
  accent: "",
  kickoff: (g) => `KICKOFF_MARKER for ${g}`,
};

test("buildStepPrompt round 1 opens with the archetype kickoff", () => {
  const out = buildStepPrompt(FAKE, "ship it", 1, 4);
  // Round 1 head is the archetype's kickoff (with the goal interpolated), not the
  // generic "Continue toward" nudge.
  assert.ok(out.startsWith("KICKOFF_MARKER for ship it"), "round 1 should open with kickoff");
  assert.ok(!out.includes("Continue toward the goal:"), "round 1 must not use the continue nudge");
});

test("buildStepPrompt round > 1 uses the continue nudge, not the kickoff", () => {
  const out = buildStepPrompt(FAKE, "ship it", 2, 4);
  assert.ok(out.startsWith("Continue toward the goal: ship it."), "round 2 should nudge to continue");
  assert.ok(!out.includes("KICKOFF_MARKER"), "round 2 must not re-send the kickoff");
});

test("buildStepPrompt suffix carries worker count, round number, archetype name, and LOOP_DONE", () => {
  const out = buildStepPrompt(FAKE, "ship it", 3, 7);
  // The shared suffix is what tells the conductor the budget + context + protocol.
  assert.ok(out.includes("Use up to 7 sub-agents working in parallel this round."), "worker count");
  assert.ok(out.includes("This is round 3 of an automated Land loop."), "round number + archetype name");
  assert.ok(out.includes(`end your reply with the exact token ${DONE_TOKEN}`), "LOOP_DONE protocol");
  assert.ok(out.includes("LOOP_CONTINUE"), "LOOP_CONTINUE protocol");
  assert.equal(DONE_TOKEN, "LOOP_DONE");
});

test("buildStepPrompt matches loop.ts wording exactly (round 1)", () => {
  // Pin the full string so a wording drift between this kernel and what the conductor
  // expects fails loudly. Mirrors the exact template in loop-core.ts.
  const archetype: Archetype = { ...FAKE, name: "Climb", kickoff: (g) => `K(${g})` };
  const out = buildStepPrompt(archetype, "the goal", 1, 4);
  const expected =
    "K(the goal)\n\n" +
    "Use up to 4 sub-agents working in parallel this round. This is round " +
    "1 of an automated Climb loop. When the goal is fully met and verified, end " +
    "your reply with the exact token LOOP_DONE. If work remains, end with LOOP_CONTINUE and " +
    "a one-line note on what is left.";
  assert.equal(out, expected);
});

test("hasDoneToken detects a plain LOOP_DONE in a line", () => {
  assert.equal(hasDoneToken(["all green", "LOOP_DONE"], "summary text"), true);
});

test("hasDoneToken detects LOOP_DONE wrapped in ANSI escape codes", () => {
  // tmux capture-pane -e emits SGR color codes around tokens; stripping must happen
  // before the scan so a color code can't hide the sentinel. \x1b is the ESC byte.
  const colored = "\x1b[32mLOOP_DONE\x1b[0m";
  assert.equal(hasDoneToken([colored], ""), true);
});

test("hasDoneToken is case-insensitive", () => {
  assert.equal(hasDoneToken(["loop_done"], ""), true);
  assert.equal(hasDoneToken(["Loop_Done"], "trailing"), true);
});

test("hasDoneToken finds the token when it is only in the summary", () => {
  assert.equal(hasDoneToken(["nothing here", "still working"], "verified: LOOP_DONE"), true);
});

test("hasDoneToken returns false when the token is absent", () => {
  assert.equal(hasDoneToken(["work remains", "LOOP_CONTINUE"], "not done yet"), false);
  assert.equal(hasDoneToken([], ""), false);
});
