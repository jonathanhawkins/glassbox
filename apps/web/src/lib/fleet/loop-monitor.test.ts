import { test } from "node:test";
import assert from "node:assert/strict";

import {
  initSweep,
  stepSweep,
  SWEEP_EMPTY_STREAK,
  initClimb,
  stepClimb,
  CLIMB_STALL_STREAK,
  CLIMB_STALL_SPACING_MS,
  type SweepState,
  type ClimbState,
} from "./loop-monitor.ts";

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

// --- Climb monitor: stop when the metric plateaus -------------------------------------------

// Drive a sequence of metric readings through the Climb monitor and return the final state.
// Readings are spaced one full stall window apart, so each flat reading is one countable stall
// (the spacing itself is pinned separately below).
function climb(metrics: (number | null)[], higherIsBetter = true, shapeId = "climb"): ClimbState {
  let s = initClimb();
  metrics.forEach((m, i) => {
    s = stepClimb(s, { shapeId, metric: m, ts: (i + 1) * CLIMB_STALL_SPACING_MS }, higherIsBetter);
  });
  return s;
}

test("a fresh Climb monitor is running, not climbed", () => {
  const s = initClimb();
  assert.equal(s.reason, "");
  assert.equal(s.climbed, false);
});

test("the first reading is a baseline, not a climb", () => {
  const s = climb([0.8]);
  assert.equal(s.best, 0.8);
  assert.equal(s.climbed, false);
  assert.equal(s.reason, "");
});

test("accuracy climbs then plateaus -> 'plateau' after the stall debounce", () => {
  assert.equal(CLIMB_STALL_STREAK, 3);
  // 0.80 baseline -> climbs to 0.92 -> then flat: stall 1,2,3 -> plateau on the 3rd flat read.
  const climbing = [0.8, 0.85, 0.92];
  assert.equal(climb(climbing).reason, ""); // still improving
  assert.equal(climb([...climbing, 0.92, 0.92]).reason, ""); // stall 1,2 - not yet
  assert.equal(climb([...climbing, 0.92, 0.92, 0.92]).reason, "plateau"); // stall 3 -> plateau
});

test("a metric that never improves past its baseline never plateaus (no false stop)", () => {
  // Already maxed (e.g. the tokenizer at accuracy 1.0): flat from the start -> never climbed.
  const s = climb([1.0, 1.0, 1.0, 1.0, 1.0]);
  assert.equal(s.climbed, false);
  assert.equal(s.reason, "");
});

test("lower-is-better (wall_ms): latency dropping is a climb; flat latency plateaus", () => {
  const dropping = [229, 180, 140]; // ms going down = improving
  assert.equal(climb(dropping, false).climbed, true);
  assert.equal(climb(dropping, false).reason, "");
  // Then it stops dropping (stuck at 140) for the debounce -> plateau.
  assert.equal(climb([...dropping, 140, 140, 140], false).reason, "plateau");
  // A regression (latency goes UP) is not an improvement, it counts toward the stall.
  assert.equal(climb([229, 180, 200, 200, 200], false).reason, "plateau");
});

test("an improvement resets the stall streak (a late gain keeps it climbing)", () => {
  const s = climb([0.8, 0.9, 0.9, 0.9, 0.95]); // flat twice, then a fresh gain
  assert.equal(s.reason, "");
  assert.equal(s.stallStreak, 0);
  assert.equal(s.best, 0.95);
});

test("stepClimb ignores non-climb shapes and null/NaN metrics", () => {
  assert.equal(climb([0.8, 0.9, 0.9, 0.9, 0.9], true, "sweep").reason, ""); // wrong shape
  // null/NaN readings are skipped, not treated as a stall.
  const s = climb([0.8, 0.9, null, null, null, null]);
  assert.equal(s.reason, "");
  assert.equal(s.best, 0.9);
});

test("rapid flat polls inside one stall window count NOTHING (a slow swarm is not a plateau)", () => {
  // The cockpit observes every ~2-3s, but a real swarm needs minutes between harness evals.
  // After a climb, hammer the monitor with flat readings 2s apart: no stall may accumulate.
  let s = initClimb();
  s = stepClimb(s, { shapeId: "climb", metric: 280, ts: 0 }, false); // baseline
  s = stepClimb(s, { shapeId: "climb", metric: 240, ts: 10_000 }, false); // climbed
  for (let t = 12_000; t < 10_000 + CLIMB_STALL_SPACING_MS; t += 2_000) {
    s = stepClimb(s, { shapeId: "climb", metric: 240, ts: t }, false);
  }
  assert.equal(s.stallStreak, 0);
  assert.equal(s.reason, "");
  // Once a full window elapses with no improvement, exactly ONE stall counts.
  s = stepClimb(s, { shapeId: "climb", metric: 240, ts: 10_000 + CLIMB_STALL_SPACING_MS }, false);
  assert.equal(s.stallStreak, 1);
});

test("plateau needs CLIMB_STALL_STREAK full windows of no improvement", () => {
  let s = initClimb();
  s = stepClimb(s, { shapeId: "climb", metric: 280, ts: 0 }, false);
  s = stepClimb(s, { shapeId: "climb", metric: 240, ts: 1_000 }, false); // climbed at t=1s
  for (let w = 1; w <= CLIMB_STALL_STREAK; w += 1) {
    assert.equal(s.reason, "", `still running before window ${w}`);
    s = stepClimb(
      s,
      { shapeId: "climb", metric: 240, ts: 1_000 + w * CLIMB_STALL_SPACING_MS },
      false,
    );
  }
  assert.equal(s.reason, "plateau");
});

test("a late improvement re-anchors the stall clock (windows restart from the gain)", () => {
  let s = initClimb();
  s = stepClimb(s, { shapeId: "climb", metric: 280, ts: 0 }, false);
  s = stepClimb(s, { shapeId: "climb", metric: 240, ts: 1_000 }, false);
  s = stepClimb(s, { shapeId: "climb", metric: 240, ts: 1_000 + CLIMB_STALL_SPACING_MS }, false); // stall 1
  s = stepClimb(s, { shapeId: "climb", metric: 200, ts: 2_000 + CLIMB_STALL_SPACING_MS }, false); // gain!
  assert.equal(s.stallStreak, 0);
  // The next stall needs a FULL window measured from the gain, not from the old anchor.
  s = stepClimb(s, { shapeId: "climb", metric: 200, ts: 2_500 + CLIMB_STALL_SPACING_MS }, false);
  assert.equal(s.stallStreak, 0);
  s = stepClimb(s, { shapeId: "climb", metric: 200, ts: 2_000 + 2 * CLIMB_STALL_SPACING_MS }, false);
  assert.equal(s.stallStreak, 1);
});

test("stepClimb is pure: it never mutates the input state", () => {
  const before = initClimb();
  const snapshot = { ...before };
  stepClimb(before, { shapeId: "climb", metric: 0.9, ts: 1_000 });
  assert.deepEqual(before, snapshot);
});
