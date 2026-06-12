import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reviveSwarmModels,
  roleKeyOf,
  modelLabel,
  DEFAULT_SWARM_MODELS,
  type SwarmModels,
} from "./role-models.ts";

// reviveSwarmModels hydrates a persisted /swarm model config: it must merge saved roles over
// the defaults so a missing role, a new field, or a corrupted entry never comes back blank.

test("reviveSwarmModels returns the defaults for null / undefined / empty", () => {
  assert.deepEqual(reviveSwarmModels(null), DEFAULT_SWARM_MODELS);
  assert.deepEqual(reviveSwarmModels(undefined), DEFAULT_SWARM_MODELS);
  assert.deepEqual(reviveSwarmModels({}), DEFAULT_SWARM_MODELS);
});

test("reviveSwarmModels ignores non-object junk and falls back to defaults", () => {
  // A corrupted localStorage value (string, number, array) has no role keys to read.
  assert.deepEqual(reviveSwarmModels("not json"), DEFAULT_SWARM_MODELS);
  assert.deepEqual(reviveSwarmModels(42), DEFAULT_SWARM_MODELS);
  assert.deepEqual(reviveSwarmModels([]), DEFAULT_SWARM_MODELS);
});

test("reviveSwarmModels overrides one role and leaves the rest at default", () => {
  const out = reviveSwarmModels({ worker: { model: "haiku", effort: "low" } });
  assert.deepEqual(out.worker, { model: "haiku", effort: "low" });
  assert.deepEqual(out.planner, DEFAULT_SWARM_MODELS.planner);
  assert.deepEqual(out.coordinator, DEFAULT_SWARM_MODELS.coordinator);
  assert.deepEqual(out.validator, DEFAULT_SWARM_MODELS.validator);
  assert.deepEqual(out.improver, DEFAULT_SWARM_MODELS.improver);
});

test("reviveSwarmModels keeps exactly the five role keys, dropping unknown keys", () => {
  const out = reviveSwarmModels({
    validator: { model: "sonnet", effort: "max" },
    bogusRole: { model: "haiku", effort: "low" },
  } as Partial<SwarmModels>);
  assert.deepEqual(Object.keys(out).sort(), [
    "coordinator",
    "improver",
    "planner",
    "validator",
    "worker",
  ]);
  assert.equal((out as Record<string, unknown>).bogusRole, undefined);
  assert.deepEqual(out.validator, { model: "sonnet", effort: "max" });
});

test("reviveSwarmModels rejects entries with a non-string model or effort", () => {
  // typeof guards: a half-written entry must fall back to the role default, not partially apply.
  const out = reviveSwarmModels({
    planner: { model: "fable" } as never, // missing effort
    coordinator: { model: 123, effort: "max" } as never, // non-string model
    worker: { model: "opus", effort: 7 } as never, // non-string effort
  });
  assert.deepEqual(out.planner, DEFAULT_SWARM_MODELS.planner);
  assert.deepEqual(out.coordinator, DEFAULT_SWARM_MODELS.coordinator);
  assert.deepEqual(out.worker, DEFAULT_SWARM_MODELS.worker);
});

test("reviveSwarmModels does not mutate DEFAULT_SWARM_MODELS and returns a fresh object", () => {
  const before = JSON.parse(JSON.stringify(DEFAULT_SWARM_MODELS));
  const out = reviveSwarmModels({ worker: { model: "haiku", effort: "low" } });
  assert.notEqual(out, DEFAULT_SWARM_MODELS, "revived config must be a new top-level object");
  assert.deepEqual(DEFAULT_SWARM_MODELS, before, "defaults must be untouched after an override");
  // An overridden role is a brand new object, never an alias of the shared default entry.
  assert.notEqual(out.worker, DEFAULT_SWARM_MODELS.worker);
});

test("reviveSwarmModels sanitizes a saved entry to exactly { model, effort }, dropping extra fields", () => {
  // A persisted entry may carry stale extra keys (an old schema, or a hand-edited localStorage
  // blob). revive rebuilds each role as a fresh { model, effort }, so leftover fields never leak.
  const out = reviveSwarmModels({
    worker: { model: "haiku", effort: "low", stale: true, ts: 123 } as never,
  });
  assert.deepEqual(out.worker, { model: "haiku", effort: "low" });
  assert.deepEqual(Object.keys(out.worker).sort(), ["effort", "model"]);
});

// roleKeyOf maps a board node name to the config row that drives its model/effort.

test("roleKeyOf folds every worker-N onto the single 'worker' row", () => {
  assert.equal(roleKeyOf("worker-1"), "worker");
  assert.equal(roleKeyOf("worker-3"), "worker");
  assert.equal(roleKeyOf("worker-12"), "worker");
});

test("roleKeyOf maps the singleton roles to themselves", () => {
  assert.equal(roleKeyOf("planner"), "planner");
  assert.equal(roleKeyOf("coordinator"), "coordinator");
  assert.equal(roleKeyOf("validator"), "validator");
  assert.equal(roleKeyOf("improver"), "improver");
});

test("roleKeyOf returns null for an unknown node", () => {
  assert.equal(roleKeyOf("oracle"), null);
  assert.equal(roleKeyOf(""), null);
  assert.equal(roleKeyOf("worker"), null); // no trailing -N, not a real lane
});

// modelLabel turns a stored model id into its menu label, passing unknown ids through.

test("modelLabel resolves known ids and passes unknown ids through unchanged", () => {
  assert.equal(modelLabel("opus"), "Opus 4.8");
  assert.equal(modelLabel("fable"), "Fable 5");
  assert.equal(modelLabel("some-future-model"), "some-future-model");
});
