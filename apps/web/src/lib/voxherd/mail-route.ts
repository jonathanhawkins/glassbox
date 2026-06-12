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
}

// Route parser: the worker id may be separated by space, hyphen, OR underscore.
const ROUTE_WORKER_RE = /worker[\s_-]?([1-4])/i;
// Count parser: worker id separated by space or hyphen only (no underscore). Intentionally
// narrower than the route parser; see the note at the top of the file.
const COUNT_WORKER_RE = /worker[\s-]?([1-4])/i;
const TASK_RE = /task[\s#:_-]*(\d+)/i;

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

/** Parse one subject into a route, or null unless it names BOTH a worker (1-4) and a task id. */
export function parseMailRoute(subject: string): MailRoute | null {
  const worker = workerInRoute(subject);
  const taskId = taskIdOf(subject);
  if (!worker || !taskId) return null;
  return { worker, taskId, subject };
}

/**
 * Route a freshly fetched inbox onto worker lanes. Agent Mail delivers newest-first, so we scan
 * oldest-first and let the latest signal win a task's lane: if a task is reassigned, both routes
 * are returned (newest last) so a caller applying them in order lands on the newest worker.
 *
 * `seen` is the caller's task -> worker dedup map, MUTATED in place: a subject that merely restates
 * an existing (task, worker) pair is skipped so the same bead is not re-emitted on the next poll.
 * Carrying `seen` across polls is what makes this idempotent for the SwarmView effect.
 */
export function routeMailToWorkers(
  mail: readonly RoutableMail[],
  seen: Map<string, string>,
): MailRoute[] {
  const routes: MailRoute[] = [];
  for (const m of [...mail].reverse()) {
    const route = parseMailRoute(m.subject);
    if (!route) continue;
    if (seen.get(route.taskId) === route.worker) continue;
    seen.set(route.taskId, route.worker);
    routes.push(route);
  }
  return routes;
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
