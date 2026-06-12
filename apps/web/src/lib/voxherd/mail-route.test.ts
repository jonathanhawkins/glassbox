import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseMailRoute,
  workerInRoute,
  workerInSubject,
  taskIdOf,
  isDoneSubject,
  routeMailToWorkers,
  taskStatesFromMail,
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
    done: false, // an assignment, not a completion
  });
  const done = parseMailRoute("worker-2 done task 14: parser passing");
  assert.equal(done!.worker, "worker-2");
  assert.equal(done!.taskId, "14");
  assert.equal(done!.done, true); // "done" / "passing" mark it finished
});

test("parseMailRoute is case-insensitive", () => {
  assert.deepEqual(parseMailRoute("WORKER-1 DONE TASK 5"), {
    taskId: "5",
    worker: "worker-1",
    subject: "WORKER-1 DONE TASK 5",
    done: true, // "DONE" marks it finished
  });
});

test("parseMailRoute returns null unless both a worker and a task id are present", () => {
  assert.equal(parseMailRoute(""), null);
  assert.equal(parseMailRoute("ship the thing"), null);
  assert.equal(parseMailRoute("worker-2 is busy"), null); // worker, no task id
  assert.equal(parseMailRoute("task 9 is queued"), null); // task, no worker
  assert.equal(parseMailRoute("reassign task to worker-3 soon"), null); // "task to ..." has no digits
});

// --- isDoneSubject: the completion vocabulary ------------------------------------------------

test("isDoneSubject recognizes completion words and rejects assign/claim/hold words", () => {
  assert.equal(isDoneSubject("worker-1 done task 2"), true);
  assert.equal(isDoneSubject("task 72 verified green"), true);
  assert.equal(isDoneSubject("worker-2 tests passing"), true);
  assert.equal(isDoneSubject("assign task 4 -> worker-2: extract"), false);
  assert.equal(isDoneSubject("worker-1 claimed task 1"), false);
  assert.equal(isDoneSubject("worker-1 hold: task 2"), false);
  assert.equal(isDoneSubject("refocus task 73 -> worker-2"), false);
});

// --- routeMailToWorkers: newest-signal-wins per task, CLAIM vs DONE, dedup via the seen map ---

test("a claim then a done across polls moves the bead onto a worker, then to done", () => {
  const seen = new Map<string, string>();
  const claim = routeMailToWorkers([{ subject: "assign task 8 -> worker-2: build" }], seen);
  assert.equal(claim.length, 1);
  assert.equal(claim[0]!.worker, "worker-2");
  assert.equal(claim[0]!.done, false);

  const done = routeMailToWorkers([{ subject: "worker-2 done task 8: built" }], seen);
  assert.equal(done.length, 1);
  assert.equal(done[0]!.done, true);
});

test("within one batch the newest signal wins: an assign+done settles on a single completion", () => {
  const routes = routeMailToWorkers(
    [
      { subject: "worker-2 done task 8: built" }, // newest: completion
      { subject: "assign task 8 -> worker-2: build" }, // older: claim
    ],
    new Map(),
  );
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.done, true); // settles on done, no intermediate-claim flicker
});

test("routeMailToWorkers returns distinct tasks oldest-first, none done", () => {
  const mail = [
    { subject: "assign task 3 -> worker-4: c" }, // newest
    { subject: "assign task 2 -> worker-1: b" },
    { subject: "assign task 1 -> worker-2: a" }, // oldest
  ];
  const routes = routeMailToWorkers(mail, new Map());
  assert.deepEqual(
    routes.map((r: MailRoute) => `${r.taskId}:${r.worker}`),
    ["1:worker-2", "2:worker-1", "3:worker-4"],
  );
  assert.ok(routes.every((r: MailRoute) => r.done === false));
});

test("routeMailToWorkers carries its seen map across polls to dedup re-emits", () => {
  const mail = [
    { subject: "worker-2 done task 8: built" },
    { subject: "assign task 8 -> worker-2: build" },
  ];
  // The seen map is the caller's cross-poll memory, MUTATED in place. The batch settles on the
  // newest signal (done), so one route emits and the recorded state is "done".
  const seen = new Map<string, string>();
  const first = routeMailToWorkers(mail, seen);
  assert.equal(first.length, 1);
  assert.equal(seen.get("8"), "done", "the task's current state is recorded in seen");

  // Same mail, same seen map (the next poll): nothing changed, so nothing re-emits (idempotent).
  assert.equal(routeMailToWorkers(mail, seen).length, 0);
});

test("routeMailToWorkers re-emits a claim when a finished task is reopened (reassigned)", () => {
  const seen = new Map<string, string>();
  // Poll 1: task 8 finishes on worker-2 -> state "done".
  routeMailToWorkers([{ subject: "worker-2 done task 8: built" }], seen);
  assert.equal(seen.get("8"), "done");
  // Poll 2: the validator reopens it onto worker-3 -> the claim re-emits (done -> worker-3).
  const reopened = routeMailToWorkers([{ subject: "assign task 8 -> worker-3: redo" }], seen);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0]!.worker, "worker-3");
  assert.equal(reopened[0]!.done, false);
});

test("routeMailToWorkers ignores non-routable subjects and returns nothing for an all-noise batch", () => {
  const mail = [
    { subject: "build passed" }, // "passed" but no worker/task id -> not routable
    { subject: "standup at noon" },
  ];
  assert.deepEqual(routeMailToWorkers(mail, new Map()), []);
});

// --- taskStatesFromMail: current per-task state (done vs assigned worker) -------------------

test("taskStatesFromMail reports each task's newest state (done vs worker)", () => {
  const mail = [
    { subject: "worker-2 done task 8: built" }, // newest for task 8 -> done
    { subject: "assign task 8 -> worker-2: build" },
    { subject: "assign task 5 -> worker-1: parse" }, // task 5 still assigned
  ];
  const states = taskStatesFromMail(mail);
  assert.equal(states.get("8"), "done");
  assert.equal(states.get("5"), "worker-1");
  assert.equal(states.get("99"), undefined); // unseen task
});

test("taskStatesFromMail lets a later completion override an earlier assignment (newest wins)", () => {
  // Same task, done is the newest entry -> state is "done" (this is how the backlog drains).
  const states = taskStatesFromMail([
    { subject: "worker-3 done task 4: shipped" },
    { subject: "assign task 4 -> worker-3: do it" },
  ]);
  assert.equal(states.get("4"), "done");
});

test("taskStatesFromMail ignores non-routable subjects", () => {
  const states = taskStatesFromMail([{ subject: "standup at noon" }, { subject: "build passed" }]);
  assert.equal(states.size, 0);
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
