import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseMailRoute,
  workerInRoute,
  workerInSubject,
  taskIdOf,
  routeMailToWorkers,
  tallyMailCounts,
  type MailRoute,
} from "./mail-route.ts";

// These pin the SwarmView mail protocol parsing. The swarm coordinates over Agent Mail subjects
// like "assign task 14 -> worker-2: parse fixtures" and "worker-2 done task 14: parser passing";
// the board routes a task bead to a worker lane (route parser) and tallies a per-lane mail count
// (count parser). The two worker regexes differ ON PURPOSE: the route parser accepts an underscore
// ("worker_2"), the count parser does not. These tests lock that difference so a future tidy-up
// cannot silently merge them.

// --- workerInRoute: the ROUTE worker parser (space / hyphen / underscore) -------------------

test("workerInRoute accepts space, hyphen, and underscore separators", () => {
  assert.equal(workerInRoute("worker-2 done task 1"), "worker-2");
  assert.equal(workerInRoute("Worker 3 picks up task 1"), "worker-3");
  assert.equal(workerInRoute("assign task 1 -> worker_4: go"), "worker-4");
});

test("workerInRoute routes only workers 1-4", () => {
  assert.equal(workerInRoute("worker-5 done task 1"), null);
  assert.equal(workerInRoute("worker-0 done task 1"), null);
  assert.equal(workerInRoute("no worker named here"), null);
});

test("workerInRoute pins the bound quirk: worker-12 reads as worker-1", () => {
  // The class captures a single [1-4] digit, so "worker-12" matches "worker-1" (the 2 is leftover).
  // Existing SwarmView behavior; the extraction preserves it rather than fixing it.
  assert.equal(workerInRoute("worker-12 done task 3"), "worker-1");
});

// --- workerInSubject: the COUNT worker parser (space / hyphen only, NO underscore) -----------

test("workerInSubject accepts space and hyphen but NOT underscore", () => {
  assert.equal(workerInSubject("worker-2 done task 1"), "worker-2");
  assert.equal(workerInSubject("Worker 3 done task 1"), "worker-3");
  // The key distinction: the count parser rejects the underscore form the route parser accepts.
  assert.equal(workerInSubject("assign task 1 -> worker_4: go"), null);
});

test("the two worker parsers diverge exactly on the underscore form", () => {
  const underscore = "assign task 1 -> worker_2: go";
  assert.equal(workerInRoute(underscore), "worker-2"); // route: underscore allowed
  assert.equal(workerInSubject(underscore), null); // count: underscore rejected
});

// --- taskIdOf: the task-id parser (space / # / colon / underscore / dash / none) ------------

test("taskIdOf reads the task id across every separator form", () => {
  assert.equal(taskIdOf("task 14"), "14");
  assert.equal(taskIdOf("task#7"), "7");
  assert.equal(taskIdOf("task: 3"), "3");
  assert.equal(taskIdOf("task-9"), "9");
  assert.equal(taskIdOf("task_6"), "6");
  assert.equal(taskIdOf("task8"), "8"); // zero separators (the * allows none)
});

test("taskIdOf keeps the whole id and returns null when there is no number", () => {
  assert.equal(taskIdOf("assign task 137 -> worker-3"), "137");
  assert.equal(taskIdOf("tasks are done"), null);
  assert.equal(taskIdOf("no id here"), null);
});

// --- parseMailRoute: needs BOTH a worker and a task id --------------------------------------

test("parseMailRoute reads the canonical assign and done subjects", () => {
  assert.deepEqual(parseMailRoute("assign task 14 -> worker-2: parse fixtures"), {
    taskId: "14",
    worker: "worker-2",
    subject: "assign task 14 -> worker-2: parse fixtures",
  });
  const done = parseMailRoute("worker-2 done task 14: parser passing");
  assert.equal(done!.worker, "worker-2");
  assert.equal(done!.taskId, "14");
});

test("parseMailRoute is case-insensitive", () => {
  assert.deepEqual(parseMailRoute("WORKER-1 DONE TASK 5"), {
    taskId: "5",
    worker: "worker-1",
    subject: "WORKER-1 DONE TASK 5",
  });
});

test("parseMailRoute returns null unless both a worker and a task id are present", () => {
  assert.equal(parseMailRoute(""), null);
  assert.equal(parseMailRoute("ship the thing"), null);
  assert.equal(parseMailRoute("worker-2 is busy"), null); // worker, no task id
  assert.equal(parseMailRoute("task 9 is queued"), null); // task, no worker
  assert.equal(parseMailRoute("reassign task to worker-3 soon"), null); // "task to ..." has no digits
});

// --- routeMailToWorkers: oldest-first scan, latest-signal-wins, dedup via the shared seen map -

test("routeMailToWorkers dedups an assign+done pair for the same task into one route", () => {
  const mail = [
    { from: "w2", subject: "worker-2 done task 8: built" }, // newest
    { from: "coord", subject: "assign task 8 -> worker-2: build" }, // older
  ];
  const routes = routeMailToWorkers(mail, new Map());
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], {
    taskId: "8",
    worker: "worker-2",
    subject: "assign task 8 -> worker-2: build", // oldest-first, so the assign subject wins the title
  });
});

test("routeMailToWorkers lets the newest signal win a reassigned task's lane", () => {
  const mail = [
    { from: "w3", subject: "worker-3 done task 5: x" }, // newest
    { from: "coord", subject: "assign task 5 -> worker-1: y" }, // older
  ];
  const routes = routeMailToWorkers(mail, new Map());
  // Both emit (oldest-first); a caller applying them in order lands the lane on the newest, worker-3.
  assert.deepEqual(routes.map((r: MailRoute) => r.worker), ["worker-1", "worker-3"]);
});

test("routeMailToWorkers scans several distinct tasks oldest-first", () => {
  const mail = [
    { from: "coord", subject: "assign task 3 -> worker-4: c" }, // newest
    { from: "coord", subject: "assign task 2 -> worker-1: b" },
    { from: "coord", subject: "assign task 1 -> worker-2: a" }, // oldest
  ];
  const routes = routeMailToWorkers(mail, new Map());
  assert.deepEqual(
    routes.map((r: MailRoute) => `${r.taskId}:${r.worker}`),
    ["1:worker-2", "2:worker-1", "3:worker-4"],
  );
});

test("routeMailToWorkers carries its seen map across polls to dedup re-emits", () => {
  const mail = [
    { from: "w2", subject: "worker-2 done task 8: built" },
    { from: "coord", subject: "assign task 8 -> worker-2: build" },
  ];
  // The seen map is the caller's cross-poll memory; routeMailToWorkers MUTATES it in place so the
  // same (task, worker) pair is not re-emitted on the next poll (the SwarmView idempotency).
  const seen = new Map<string, string>();
  const first = routeMailToWorkers(mail, seen);
  assert.equal(first.length, 1);
  assert.equal(seen.get("8"), "worker-2", "the routed task -> worker pair is recorded in seen");

  // Same mail, same seen map (the next poll): the pair is already known, so nothing re-emits.
  assert.equal(routeMailToWorkers(mail, seen).length, 0);
});

test("routeMailToWorkers ignores non-routable subjects and returns nothing for an all-noise batch", () => {
  const mail = [
    { from: "a", subject: "build passed" },
    { from: "b", subject: "standup at noon" },
  ];
  assert.deepEqual(routeMailToWorkers(mail, new Map()), []);
});

// --- tallyMailCounts: a sender's lane is learned from any worker-naming subject -------------

test("tallyMailCounts attributes a sender's other mail to its learned lane", () => {
  const mail = [
    { from: "Ann", subject: "assign task 1 -> worker-2: x" }, // learns Ann -> worker-2
    { from: "Ann", subject: "status: still building" }, // no worker, counts to Ann's lane
    { from: "Bo", subject: "worker-3 done task 2: y" }, // learns Bo -> worker-3
    { from: "Cy", subject: "just checking in" }, // never names a worker, not counted
  ];
  assert.deepEqual(tallyMailCounts(mail), { "worker-2": 2, "worker-3": 1 });
});

test("tallyMailCounts returns an empty tally when no subject names a worker", () => {
  assert.deepEqual(tallyMailCounts([{ from: "a", subject: "hello" }]), {});
});
