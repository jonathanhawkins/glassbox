import { test } from "node:test";
import assert from "node:assert/strict";

import { norm, isActive, isComplete, selectActiveTasks, MAX_ACTIVE } from "./swarm-adapter.ts";

// Pins the swarm adapter's task FILTERING: the pure filter / sort / cap the board's poll lifts a
// conductor task list into the active backlog it draws as beads. The board shows only active-status
// tasks, newest first (numeric id desc), capped at MAX_ACTIVE, and treats a task as gone once its
// status reads complete. These helpers were lifted out of startSwarmAdapter.tick so the selection
// can be tested directly, without a fake fetch or timer.

// --- norm: status normalization ---------------------------------------------------------------

test("norm defaults a missing status to pending", () => {
  // A task with no status is treated as freshly queued, not dropped.
  assert.equal(norm(undefined), "pending");
});

test("norm lowercases and collapses internal whitespace to a single underscore", () => {
  assert.equal(norm("In Progress"), "in_progress");
  assert.equal(norm("DONE"), "done");
  assert.equal(norm("in   progress"), "in_progress"); // a run of spaces collapses to one underscore
  assert.equal(norm("Blocked"), "blocked");
});

// --- isActive / isComplete: the two status sets -----------------------------------------------

test("isActive is true for the four backlog statuses (and a missing status)", () => {
  for (const s of ["pending", "in_progress", "claimed", "blocked"]) {
    assert.equal(isActive(s), true, `${s} should be active`);
  }
  assert.equal(isActive("In Progress"), true); // normalized before the set check
  assert.equal(isActive(undefined), true); // missing status defaults to pending, which is active
});

test("isActive is false for completed, done, and unknown statuses", () => {
  assert.equal(isActive("completed"), false);
  assert.equal(isActive("done"), false);
  assert.equal(isActive("archived"), false); // not in the active set
});

test("isComplete is true only for completed and done, case-insensitively", () => {
  assert.equal(isComplete("completed"), true);
  assert.equal(isComplete("done"), true);
  assert.equal(isComplete("Completed"), true);
  assert.equal(isComplete("DONE"), true);
  assert.equal(isComplete("pending"), false);
  assert.equal(isComplete("in_progress"), false);
  assert.equal(isComplete(undefined), false); // defaults to pending, not complete
});

// --- selectActiveTasks: filter -> newest-first -> cap -----------------------------------------

test("selectActiveTasks keeps only active tasks, newest first", () => {
  const out = selectActiveTasks([
    { id: 1, status: "pending" },
    { id: 2, status: "completed" },
    { id: 3, status: "in_progress" },
    { id: 4, status: "archived" },
    { id: 5, status: "done" },
  ]);
  // 2 and 5 are complete, 4 is unknown: all dropped. 1 and 3 remain, newest (higher id) first.
  assert.deepEqual(
    out.map((t) => t.id),
    [3, 1],
  );
});

test("selectActiveTasks sorts newest-first by NUMERIC id, not lexically", () => {
  const out = selectActiveTasks([
    { id: "2", status: "pending" },
    { id: "10", status: "pending" },
    { id: "1", status: "pending" },
  ]);
  // Numeric desc is [10, 2, 1]; a string sort would wrongly order "2" ahead of "10".
  assert.deepEqual(
    out.map((t) => t.id),
    ["10", "2", "1"],
  );
});

test("selectActiveTasks caps the backlog at MAX_ACTIVE, keeping the highest ids", () => {
  assert.equal(MAX_ACTIVE, 16);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, status: "pending" }));
  const out = selectActiveTasks(many);
  assert.equal(out.length, MAX_ACTIVE);
  assert.equal(out[0].id, 20); // newest kept
  assert.equal(out[out.length - 1].id, 5); // ids 20..5 kept
  assert.equal(
    out.some((t) => Number(t.id) <= 4),
    false,
    "ids 4..1 are past the cap and must be dropped",
  );
});

test("selectActiveTasks returns an empty list when nothing is active", () => {
  assert.deepEqual(selectActiveTasks([]), []);
  assert.deepEqual(
    selectActiveTasks([
      { id: 1, status: "done" },
      { id: 2, status: "completed" },
    ]),
    [],
  );
});

test("selectActiveTasks does not mutate its input array", () => {
  const input = [
    { id: 1, status: "pending" },
    { id: 2, status: "pending" },
  ];
  const before = input.map((t) => t.id);
  selectActiveTasks(input);
  assert.deepEqual(
    input.map((t) => t.id),
    before,
    "filter/sort must operate on a copy, leaving the caller's array order intact",
  );
});
