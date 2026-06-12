// Parse the swarm's coordination mail into board signals. The voxherd task list carries no
// assignee, but the swarm's Agent Mail does: the role prompts require protocol subjects like
// "assign task 14 -> worker-2: parse fixtures" and "worker-2 done task 14: parser passing".
// SwarmView turns those subjects into (a) per-worker-lane task ROUTES (a task bead claimed onto
// a worker's dock) and (b) per-lane mail COUNT badges. This module is the pure, framework-free
// kernel of both so they can be unit tested directly; the component stays a thin wrapper.
//
// NOTE: two deliberately DIFFERENT worker regexes. The ROUTE parser accepts "worker_2"
// (underscore) because assignment subjects sometimes use it; the COUNT parser does not. They are
// kept distinct on purpose. The tests pin the difference so a future tidy-up cannot silently
// merge them.

/** A mail item the router reads: only the subject carries the protocol. */
export interface RoutableMail {
  subject: string;
}

/** A mail item the count tally reads: the sender's name plus the subject. */
export interface CountableMail {
  from: string;
  subject: string;
}

/** A routed lane assignment derived from a subject naming both a worker and a task id. */
export interface MailRoute {
  worker: string; // "worker-1".."worker-4"
  taskId: string;
  subject: string; // the subject that produced the route (bead title fallback)
  // True when the subject REPORTS the task finished ("worker-1 done task 2", "task 72 verified
  // green") rather than assigning it. The worker marks completion in its OWN task list, not the
  // planner's, so this mail is the board's only signal to retire the bead to the done rail.
  done: boolean;
}

// Route parser: the worker id may be separated by space, hyphen, OR underscore.
const ROUTE_WORKER_RE = /worker[\s_-]?([1-4])/i;
// Count parser: worker id separated by space or hyphen only (no underscore). Intentionally
// narrower than the route parser; see the note at the top of the file.
const COUNT_WORKER_RE = /worker[\s-]?([1-4])/i;
const TASK_RE = /task[\s#:_-]*(\d+)/i;
// Completion vocabulary: a subject reports a task FINISHED (not merely assigned/claimed). Kept
// deliberately broad because workers phrase it freely ("done", "verified green", "tests passing").
const DONE_RE = /\b(done|verified|complete|completed|pass(?:ed|es|ing)?|green|landed|shipped|merged|resolved|closed)\b/i;

/** The worker lane named in a routing subject, or null. Accepts "worker-2","Worker 3","worker_4". */
export function workerInRoute(s: string): string | null {
  const m = s.match(ROUTE_WORKER_RE);
  return m ? `worker-${m[1]}` : null;
}

/** The worker lane named in a subject for COUNT attribution (no underscore form), or null. */
export function workerInSubject(s: string): string | null {
  const m = s.match(COUNT_WORKER_RE);
  return m ? `worker-${m[1]}` : null;
}

/** The task id named in a subject, or null. Accepts "task 14","task#7","task: 3","task-9","task7". */
export function taskIdOf(s: string): string | null {
  const m = s.match(TASK_RE);
  return m ? m[1] : null;
}

/** True when a subject REPORTS a task as finished (vs merely assigning or claiming it). */
export function isDoneSubject(s: string): boolean {
  return DONE_RE.test(s);
}

/** Parse one subject into a route, or null unless it names BOTH a worker (1-4) and a task id. */
export function parseMailRoute(subject: string): MailRoute | null {
  const worker = workerInRoute(subject);
  const taskId = taskIdOf(subject);
  if (!worker || !taskId) return null;
  return { worker, taskId, subject, done: isDoneSubject(subject) };
}

/**
 * Route a freshly fetched inbox onto the lanes. Each task is reduced to its CURRENT state from
 * its NEWEST routable subject (Agent Mail delivers newest-first), then we emit a transition only
 * if that state changed since the last poll. A task's state is "done" once a completion subject is
 * its newest signal, else its owning worker lane. So: assign -> the bead is claimed onto a worker;
 * a later done -> the bead is retired; a reopen after done -> it is re-claimed. Reducing per task
 * (rather than per message) is what makes it idempotent: re-polling a batch that already holds both
 * an assign and a done settles on the newest (done) and does not oscillate.
 *
 * `seen` is the caller's task -> state map, MUTATED in place and carried across polls. Routes are
 * returned oldest-task-first so a caller applying them in order moves chronologically.
 */
// Newest-first scan: the first routable subject seen for a task is its newest = current signal.
function latestRoutePerTask(mail: readonly RoutableMail[]): Map<string, MailRoute> {
  const latest = new Map<string, MailRoute>();
  for (const m of mail) {
    const route = parseMailRoute(m.subject);
    if (route && !latest.has(route.taskId)) latest.set(route.taskId, route);
  }
  return latest;
}

export function routeMailToWorkers(
  mail: readonly RoutableMail[],
  seen: Map<string, string>,
): MailRoute[] {
  const routes: MailRoute[] = [];
  for (const route of [...latestRoutePerTask(mail).values()].reverse()) {
    const state = route.done ? "done" : route.worker;
    if (seen.get(route.taskId) === state) continue;
    seen.set(route.taskId, state);
    routes.push(route);
  }
  return routes;
}

/**
 * The CURRENT state of each task from the coordination mail: "done" when the task's newest signal
 * is a completion ("worker-2 done task 14"), else the worker lane it is assigned to. This is how
 * the board knows progress without a shared task list: each spawned agent completes in its OWN
 * task list (so the polled list never drains), but the swarm announces completion over mail. The
 * counts derive backlog/done from this, so the Sweep monitor sees the backlog actually drain.
 */
export function taskStatesFromMail(mail: readonly RoutableMail[]): Map<string, string> {
  const states = new Map<string, string>();
  for (const [taskId, route] of latestRoutePerTask(mail)) {
    states.set(taskId, route.done ? "done" : route.worker);
  }
  return states;
}

/**
 * Tally recent mail into a per-worker-lane message count for the lane badges. A sender's lane is
 * learned from any of its messages that names a worker (the last such message wins), so that
 * sender's OTHER messages (which may not name a worker) count toward the same lane. A sender whose
 * lane was never learned contributes nothing. Returns counts keyed by "worker-N"; absent lanes are
 * simply missing (the caller defaults them to 0).
 */
export function tallyMailCounts(mail: readonly CountableMail[]): Record<string, number> {
  const nameToWorker: Record<string, string> = {};
  for (const m of mail) {
    const w = workerInSubject(m.subject);
    if (w) nameToWorker[m.from] = w;
  }
  const counts: Record<string, number> = {};
  for (const m of mail) {
    const w = nameToWorker[m.from] ?? workerInSubject(m.subject);
    if (w) counts[w] = (counts[w] ?? 0) + 1;
  }
  return counts;
}
