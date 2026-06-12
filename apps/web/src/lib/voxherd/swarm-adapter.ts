// Swarm adapter: turn a conductor session's REAL voxherd signals into the board's
// GlassboxEvent vocabulary. The board runs in REAL mode (no simulated status side-effects),
// so it renders only what the data actually says.
//
// Source: the swarm's Claude Code task list. Each session writes to its OWN list (keyed by
// session id, NOT project name), so the canonical plan lives under the planner's session for a
// spawned swarm, the conductor's for an in-session rail loop, and the project name for a legacy
// run. fetchSwarmTasks() resolves whichever holds it. The tasks carry no assignee field, so we
// show them as the backlog (capped, newest-first) and slide a bead to "done" when its task
// completes; SwarmView routes the backlog beads onto worker lanes from the swarm's REAL Agent
// Mail ("assign task 14 -> worker-2: ..."), which genuinely carries ownership.

import type { GlassboxEvent } from "@glassbox/contract";

export const MAX_ACTIVE = 16;
const ACTIVE = new Set(["pending", "in_progress", "claimed", "blocked"]);
const COMPLETE = new Set(["completed", "done"]);

export interface SwarmTask {
  id: string | number;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: string;
}

/** Normalize a raw task status: default missing to "pending", lowercase, collapse spaces to "_". */
export const norm = (s?: string) => (s ?? "pending").toLowerCase().replace(/\s+/g, "_");

/** True when a task's (normalized) status puts it in the active backlog. */
export function isActive(status?: string): boolean {
  return ACTIVE.has(norm(status));
}

/** True when a task's (normalized) status means it has left the queue as done. */
export function isComplete(status?: string): boolean {
  return COMPLETE.has(norm(status));
}

/**
 * The conductor's active backlog as the board shows it: keep only active-status tasks, newest
 * first (numeric id desc), capped at MAX_ACTIVE for legibility. Pure; the exact filter/sort/cap
 * the adapter's tick applies, lifted out so it can be unit tested.
 */
export function selectActiveTasks<T extends { id: string | number; status?: string }>(
  tasks: readonly T[],
): T[] {
  return tasks
    .filter((t) => isActive(t.status))
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, MAX_ACTIVE);
}

/**
 * The header's "clear" snapshot for one conductor: everything on the board at clear time stays
 * hidden afterwards. Mail is floored by id (the feed's ids are monotonic), tasks by the exact
 * ids visible in the resolved list. The snapshot is scoped to the task-list KEY it was taken
 * from, because a NEXT run spawns a fresh planner whose list restarts numbering at 1; without
 * the key scope, the old run's cleared ids would swallow the new run's plan.
 */
export interface ClearFloor {
  /** Hide mail with id <= this (0 = hide nothing). */
  mailId: number;
  /** The task-list key (session id / project) the task snapshot came from. */
  taskKey: string;
  /** Task ids visible at clear time; hidden while the same key resolves. */
  taskIds: string[];
}

/** Drop the tasks a clear snapshotted, when (and only when) the same list key resolved. */
export function filterClearedTasks<T extends { id: string | number }>(
  key: string,
  tasks: readonly T[],
  floor?: ClearFloor | null,
): T[] {
  if (!floor || floor.taskKey !== key) return [...tasks];
  const cleared = new Set(floor.taskIds);
  return tasks.filter((t) => !cleared.has(String(t.id)));
}

/**
 * Resolve the swarm's task list. Each session writes to its OWN task list (keyed by session id,
 * not project name), so a spawned swarm's plan lives under the planner's session id, an in-session
 * rail loop under the conductor's, and a legacy run under the project name. We try the candidate
 * keys in priority order and use the FIRST that has tasks, so the board reads the canonical plan
 * wherever it landed. Returns the tasks plus the key that won.
 */
export async function fetchSwarmTasks(
  keys: string[],
): Promise<{ key: string; tasks: SwarmTask[] }> {
  for (const key of keys) {
    if (!key) continue;
    try {
      const res = await fetch(`/api/voxherd/api/tasks/${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { tasks?: SwarmTask[] } | SwarmTask[];
      const tasks = Array.isArray(data) ? data : (data.tasks ?? []);
      if (tasks.length) return { key, tasks };
    } catch {
      /* try the next candidate */
    }
  }
  return { key: "", tasks: [] };
}

export function startSwarmAdapter(opts: {
  sessionId: string;
  // Candidate task-list keys in priority order (planner session, conductor session, project).
  // A getter, not a static value, so the adapter picks up the planner key the instant it spawns
  // without re-subscribing.
  getKeys: () => string[];
  // The conductor's clear snapshot (or null). A getter for the same reason as getKeys: the
  // operator can hit "clear" mid-run and the very next tick must stop re-creating those beads.
  getFloor?: () => ClearFloor | null;
  workers?: number;
  onEvent: (ev: GlassboxEvent) => void;
}): () => void {
  const { getKeys, getFloor, onEvent } = opts;
  const runId = `swarm-${opts.sessionId}`;
  let alive = true;
  const phaseOf = new Map<string, string>(); // taskId -> "queued" | "done"

  const emit = (
    type: GlassboxEvent["type"],
    agent: string,
    extra: Partial<GlassboxEvent> = {},
  ) => {
    onEvent({ ts: Date.now(), type, run_id: runId, planner_version: 1, agent, ...extra } as GlassboxEvent);
  };

  const tick = async () => {
    const { key, tasks: fetched } = await fetchSwarmTasks(getKeys());
    if (!alive) return;
    // Cleared tasks never re-seed beads, including after a reload (phaseOf restarts empty).
    const tasks = filterClearedTasks(key, fetched, getFloor?.());

    // The active tasks = the backlog. Newest first, capped for legibility.
    const active = selectActiveTasks(tasks);

    for (const t of active) {
      const id = String(t.id);
      if (phaseOf.get(id) === undefined) {
        const title = t.subject ?? t.activeForm ?? id;
        emit("bead_created", "planner", { bead_id: `task-${id}`, title, payload: { capability: "task" } });
        phaseOf.set(id, "queued");
      }
    }

    // A tracked task completing leaves the queue. No fake worker/validator is credited (real
    // mode), so bead_done just slides the bead to the done rail.
    for (const t of tasks) {
      const id = String(t.id);
      if (isComplete(t.status) && phaseOf.has(id) && phaseOf.get(id) !== "done") {
        emit("bead_done", "coordinator", { bead_id: `task-${id}`, payload: { capability: "task" } });
        phaseOf.set(id, "done");
      }
    }
  };

  void tick();
  const timer = setInterval(tick, 1500);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
