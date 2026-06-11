import { test } from "node:test";
import assert from "node:assert/strict";

import { ARCHETYPES, type Archetype } from "./archetypes.ts";

// Drive every assertion off the ARCHETYPES array, keyed by id, so this stays
// exhaustive: if a shape is added or renamed, the lookup or the coverage check
// below fails loudly instead of silently skipping it.
const byId = new Map<string, Archetype>(ARCHETYPES.map((a) => [a.id, a]));

// Markers shared by the decompose -> dispatch-to-sub-agents -> verify cycle that
// every loop shape wraps. Each shape's kickoff must carry all of these.
const SHARED_CYCLE_MARKERS = [
  "DECOMPOSE",
  "DISPATCH",
  "VERIFY",
  "TaskCreate",
  "sub-agent",
] as const;

// Each shape's own stop phrase, the one line that makes its motion distinct.
const STOP_PHRASE: Record<string, RegExp> = {
  land: /fully met|then stop/,
  climb: /metric|beat your best/,
  hold: /invariant|holding the line/,
  watch: /digest/,
  burst: /one round/i,
  sweep: /backlog is empty/,
  dig: /two consecutive rounds|nothing new/,
  race: /ONE winner|judge/,
};

const ALL_IDS = ["land", "climb", "hold", "watch", "burst", "sweep", "dig", "race"];

test("ARCHETYPES covers exactly the 8 loop shapes", () => {
  assert.equal(ARCHETYPES.length, 8);
  assert.deepEqual([...byId.keys()].sort(), [...ALL_IDS].sort());
  // Every shape we assert on below resolves to a real archetype.
  assert.deepEqual(Object.keys(STOP_PHRASE).sort(), [...ALL_IDS].sort());
});

for (const id of ALL_IDS) {
  test(`${id}: kickoff interpolates the goal`, () => {
    const a = byId.get(id);
    assert.ok(a, `no archetype with id "${id}"`);
    assert.match(a!.kickoff("MY_UNIQUE_GOAL"), /MY_UNIQUE_GOAL/);
  });

  test(`${id}: kickoff carries the shared cycle markers`, () => {
    const a = byId.get(id);
    assert.ok(a, `no archetype with id "${id}"`);
    const prompt = a!.kickoff("some goal");
    for (const marker of SHARED_CYCLE_MARKERS) {
      assert.ok(
        prompt.includes(marker),
        `${id} kickoff is missing shared cycle marker "${marker}"`,
      );
    }
  });

  test(`${id}: kickoff contains its own stop phrase`, () => {
    const a = byId.get(id);
    assert.ok(a, `no archetype with id "${id}"`);
    assert.match(a!.kickoff("some goal"), STOP_PHRASE[id]);
  });
}
