// Contract guard: the archetype METADATA in archetypes.ts must stay in lockstep with
// the canonical loop-shape ids in contract/glassbox.contract.json (exported as
// ARCHETYPE_IDS). A drifted id silently breaks the board overlay and the Python side,
// so this two-way membership check is the seam's regression net.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ARCHETYPES } from "./archetypes.ts";
import { ARCHETYPE_IDS } from "@glassbox/contract";

const REQUIRED_STRING_FIELDS = ["id", "name", "tagline", "whenToUse", "stop", "accent"] as const;

test("there are exactly 8 archetypes", () => {
  assert.equal(ARCHETYPES.length, 8);
});

test("all archetype ids are unique", () => {
  const ids = ARCHETYPES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in: ${ids.join(", ")}`);
});

test("all archetype names are unique", () => {
  const names = ARCHETYPES.map((a) => a.name);
  assert.equal(new Set(names).size, names.length, `duplicate name in: ${names.join(", ")}`);
});

test("every archetype id is a member of the contract's ARCHETYPE_IDS", () => {
  const canonical = new Set(ARCHETYPE_IDS as readonly string[]);
  for (const a of ARCHETYPES) {
    assert.ok(canonical.has(a.id), `archetype id "${a.id}" is not in ARCHETYPE_IDS`);
  }
});

test("every ARCHETYPE_IDS entry has a matching archetype (two-way)", () => {
  const present = new Set(ARCHETYPES.map((a) => a.id));
  for (const id of ARCHETYPE_IDS as readonly string[]) {
    assert.ok(present.has(id), `contract id "${id}" has no matching archetype`);
  }
});

test("every required field is a present, non-empty string", () => {
  for (const a of ARCHETYPES) {
    for (const field of REQUIRED_STRING_FIELDS) {
      const value = (a as unknown as Record<string, unknown>)[field];
      assert.equal(typeof value, "string", `${a.id}.${field} should be a string`);
      assert.ok(
        (value as string).trim().length > 0,
        `${a.id}.${field} should be a non-empty string`,
      );
    }
  }
});

test("kickoff is a function whose result is a non-empty string", () => {
  for (const a of ARCHETYPES) {
    assert.equal(typeof a.kickoff, "function", `${a.id}.kickoff should be a function`);
    const result = a.kickoff("ship the thing");
    assert.equal(typeof result, "string", `${a.id}.kickoff should return a string`);
    assert.ok(result.trim().length > 0, `${a.id}.kickoff should return a non-empty string`);
  }
});

test("accent is a tailwind text color class (matches /^text-/)", () => {
  for (const a of ARCHETYPES) {
    assert.match(a.accent, /^text-/, `${a.id}.accent "${a.accent}" should start with text-`);
  }
});
