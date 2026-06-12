import { test } from "node:test";
import assert from "node:assert/strict";

import { startArchetypeLoop, type LoopState } from "./loop.ts";
import type { Archetype } from "@/lib/fleet/archetypes";

// Minimal archetype: kickoff is identifiable so we can assert round 1 sends it.
const ARCHETYPE: Archetype = {
  id: "land",
  name: "Land",
  tagline: "",
  detail: "",
  whenToUse: "",
  example: "",
  stop: "",
  accent: "",
  kickoff: (g) => `KICKOFF(${g})`,
};

// A test harness around the two injected I/O seams. sendCommand records every message and
// returns ok; openTerminalStream captures the onStop callback so a test can fire turn-stop
// events by hand, and exposes a resolve gate so we control when the loop actually starts
// (loop.ts only kicks off the first round after the openStream promise resolves).
function makeHarness(opts?: { sendResult?: { ok?: boolean; error?: string } }) {
  const sent: string[] = [];
  const states: LoopState[] = [];
  let onStop: ((summary: string) => void) | undefined;
  let cleaned = 0;

  const sendCommand = async (input: { project: string; session_id?: string; message: string }) => {
    sent.push(input.message);
    return opts?.sendResult ?? { ok: true };
  };

  const openTerminalStream = async (
    _sessionId: string,
    _onContent: (lines: string[]) => void,
    stop?: (summary: string) => void,
  ): Promise<() => void> => {
    onStop = stop;
    return () => {
      cleaned += 1;
    };
  };

  return {
    sent,
    states,
    fireStop: (summary: string) => {
      assert.ok(onStop, "onStop not registered yet (loop has not started)");
      onStop!(summary);
    },
    get cleaned() {
      return cleaned;
    },
    deps: { sendCommand, openTerminalStream },
    onState: (s: LoopState) => states.push({ ...s }),
  };
}

// Drain the microtask queue. The loop chains promises (lazy import() of the kernel + deps ->
// openStream() -> async runRound -> await send), so several continuations must run before a
// state is observable. setImmediate yields a full macrotask turn, which flushes any pending
// microtasks (including dynamic-import resolution) without any real timers or network, so the
// test stays deterministic.
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function start(h: ReturnType<typeof makeHarness>, over?: { maxRounds?: number; workers?: number }) {
  return startArchetypeLoop(
    {
      session: { project: "proj", session_id: "sess-1" },
      archetype: ARCHETYPE,
      goal: "ship it",
      workers: over?.workers ?? 4,
      maxRounds: over?.maxRounds ?? 8,
      onState: h.onState,
    },
    h.deps,
  );
}

test("round 1 sends the archetype kickoff prompt", async () => {
  const h = makeHarness();
  start(h);
  await tick();
  assert.equal(h.sent.length, 1, "exactly one message sent for round 1");
  assert.ok(h.sent[0].startsWith("KICKOFF(ship it)"), "round 1 carries the kickoff");
  assert.ok(h.sent[0].includes("This is round 1 of an automated Land loop."), "round-1 suffix");
});

test("firing onStop with LOOP_DONE finishes the loop (done, not running)", async () => {
  const h = makeHarness();
  start(h);
  await tick();
  h.fireStop("all verified LOOP_DONE");
  await tick();

  const last = h.states.at(-1)!;
  assert.equal(last.reason, "done");
  assert.equal(last.running, false);
  // No new round was dispatched after done.
  assert.equal(h.sent.length, 1, "must not send a round-2 prompt after done");
  assert.equal(last.lastSummary, "all verified LOOP_DONE");
});

test("firing onStop WITHOUT the token advances to round 2", async () => {
  const h = makeHarness();
  start(h);
  await tick();
  assert.equal(h.sent.length, 1);

  h.fireStop("still working LOOP_CONTINUE");
  await tick();

  assert.equal(h.sent.length, 2, "a second prompt is sent for round 2");
  assert.ok(h.sent[1].startsWith("Continue toward the goal: ship it."), "round 2 uses the continue nudge");
  assert.ok(h.sent[1].includes("This is round 2 of an automated Land loop."), "round-2 suffix");
  const last = h.states.at(-1)!;
  assert.equal(last.running, true, "still running between rounds");
  assert.equal(last.round, 2);
  assert.equal(last.reason, "");
});

test("reaching maxRounds finishes with 'max rounds'", async () => {
  // maxRounds: 2 -> round 1 sends, round 2 sends, the next onStop pushes round to 3 (> max).
  const h = makeHarness();
  start(h, { maxRounds: 2 });
  await tick();
  assert.equal(h.sent.length, 1);

  h.fireStop("LOOP_CONTINUE"); // -> round 2
  await tick();
  assert.equal(h.sent.length, 2);

  h.fireStop("LOOP_CONTINUE"); // -> round 3 > max, finishes before sending
  await tick();

  assert.equal(h.sent.length, 2, "no round-3 prompt is sent past the budget");
  const last = h.states.at(-1)!;
  assert.equal(last.reason, "max rounds");
  assert.equal(last.running, false);
});

test("the returned stop() finishes with 'stopped'", async () => {
  const h = makeHarness();
  const handle = start(h);
  await tick();

  handle.stop();
  await tick();

  const last = h.states.at(-1)!;
  assert.equal(last.reason, "stopped");
  assert.equal(last.running, false);
  // Stopping mid-round means a later onStop is ignored (no new round dispatched).
  h.fireStop("LOOP_CONTINUE");
  await tick();
  assert.equal(h.sent.length, 1, "no further prompts after stop()");
});

test("a failed send finishes with a send-failed reason", async () => {
  const h = makeHarness({ sendResult: { ok: false, error: "boom" } });
  start(h);
  await tick();
  const last = h.states.at(-1)!;
  assert.equal(last.running, false);
  assert.match(last.reason, /send failed: boom/);
});
