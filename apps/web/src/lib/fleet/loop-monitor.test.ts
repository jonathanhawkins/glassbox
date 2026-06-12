import { test } from "node:test";
import assert from "node:assert/strict";

import { initSweep, stepSweep, SWEEP_EMPTY_STREAK, type SweepState } from "./loop-monitor.ts";

// The Sweep monitor pins how a spawned swarm's backlog-drained stop condition is DETECTED from the
// live task-poll counts: backlog goes up as the planner fans out, then drains to empty, and once it
// stays empty (debounced) with completed work the loop is "done". Land/Climb extend this kernel.

// Drive a sequence of observations through the monitor and return the final state.
function run(obs: { shapeId?: string; backlog: number; done: number }[]): SweepState {
  let s = initSweep();
  for (const o of obs) s = stepSweep(s, { shapeId: o.shapeId ?? "sweep", backlog: o.backlog, done: o.done });
  return s;
}

test("a fresh monitor is running, not worked, not drained", () => {
  const s = initSweep();
  assert.equal(s.reason, "");
  assert.equal(s.worked, false);
  assert.equal(s.emptyStreak, 0);
});

test("an initial empty backlog does NOT count as drained (the swarm has not started)", () => {
  // Empty from the very start, never any work: must stay running, no false 'done'.
  const s = run([
    { backlog: 0, done: 0 },
    { backlog: 0, done: 0 },
    { backlog: 0, done: 0 },
    { backlog: 0, done: 0 },
  ]);
  assert.equal(s.reason, "");
  assert.equal(s.worked, false);
});

test("backlog drains to empty and STAYS empty -> done after the debounce", () => {
  const seq = [
    { backlog: 4, done: 0 }, // plan fans out
    { backlog: 2, done: 2 }, // draining
    { backlog: 0, done: 4 }, // empty (streak 1) - not yet
    { backlog: 0, done: 4 }, // empty (streak 2) - not yet
    { backlog: 0, done: 4 }, // empty (streak SWEEP_EMPTY_STREAK) - drained
  ];
  assert.equal(SWEEP_EMPTY_STREAK, 3);
  // Before the final observation it must still be running...
  assert.equal(run(seq.slice(0, 4)).reason, "");
  // ...and only after the sustained-empty streak does it report done.
  assert.equal(run(seq).reason, "done");
});

test("a momentary empty gap between waves does NOT trip done", () => {
  const s = run([
    { backlog: 3, done: 0 }, // wave 1
    { backlog: 0, done: 1 }, // brief gap (streak 1)
    { backlog: 0, done: 1 }, // gap (streak 2)
    { backlog: 2, done: 1 }, // wave 2 arrives BEFORE the streak hit 3 -> resets
    { backlog: 0, done: 3 }, // empty (streak 1 again)
  ]);
  assert.equal(s.reason, ""); // still running: the new wave reset the streak
  assert.equal(s.emptyStreak, 1);
});

test("done requires at least one completed task (an empty plan that never ran is not 'drained')", () => {
  const s = run([
    { backlog: 1, done: 0 }, // had work...
    { backlog: 0, done: 0 }, // ...but it vanished with nothing completed
    { backlog: 0, done: 0 },
    { backlog: 0, done: 0 },
  ]);
  assert.equal(s.reason, ""); // done==0 -> not counted as a real drain
});

test("only the Sweep shape drains; other shapes never auto-stop here", () => {
  const s = run([
    { shapeId: "land", backlog: 3, done: 0 },
    { shapeId: "land", backlog: 0, done: 3 },
    { shapeId: "land", backlog: 0, done: 3 },
    { shapeId: "land", backlog: 0, done: 3 },
  ]);
  assert.equal(s.reason, ""); // Land's stop condition is not backlog-drained; no false done
});

test("a reopen (new work after draining) clears the done state back to running", () => {
  let s = run([
    { backlog: 2, done: 0 },
    { backlog: 0, done: 2 },
    { backlog: 0, done: 2 },
    { backlog: 0, done: 2 },
  ]);
  assert.equal(s.reason, "done");
  // The validator reopens the backlog -> back to running.
  s = stepSweep(s, { shapeId: "sweep", backlog: 1, done: 2 });
  assert.equal(s.reason, "");
  assert.equal(s.emptyStreak, 0);
});

test("stepSweep is pure: it never mutates the input state", () => {
  const before = initSweep();
  const snapshot = { ...before };
  stepSweep(before, { shapeId: "sweep", backlog: 5, done: 0 });
  assert.deepEqual(before, snapshot);
});
