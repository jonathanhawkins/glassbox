// Swarm adapter: turn a conductor session's REAL voxherd signals into the board's
// GlassboxEvent vocabulary. The board runs in REAL mode (no simulated status side-effects),
// so it renders only what the data actually says.
//
// Source: the conductor's Claude Code task list (GET /api/tasks/{project}). These tasks carry
// NO owner/assignee field (verified: keys are id/subject/description/status/activeForm/
// blocks/blockedBy), so we show them honestly as the conductor's active QUEUE (backlog beads,
// capped + newest-first for legibility) and move a bead to "done" when its task completes. This
// adapter does NOT route tasks to worker lanes (the task list has no data for "worker-N owns
// task X"); SwarmView routes them instead from the swarm's REAL Agent Mail, whose protocol
// subjects ("assign task 14 -> worker-2: ...") genuinely carry ownership. Worker/validator/
// improver lane statuses light up from real session activity via agent_status events.

import type { GlassboxEvent } from "@glassbox/contract";

const MAX_ACTIVE = 16;
const ACTIVE = new Set(["pending", "in_progress", "claimed", "blocked"]);
const COMPLETE = new Set(["completed", "done"]);

interface SwarmTask {
  id: string | number;
  subject?: string;
  activeForm?: string;
  status?: string;
}

const norm = (s?: string) => (s ?? "pending").toLowerCase().replace(/\s+/g, "_");

export function startSwarmAdapter(opts: {
  sessionId: string;
  project: string;
  workers?: number;
  onEvent: (ev: GlassboxEvent) => void;
}): () => void {
  const { project, onEvent } = opts;
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
    let tasks: SwarmTask[] = [];
    try {
      const res = await fetch(`/api/voxherd/api/tasks/${encodeURIComponent(project)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { tasks?: SwarmTask[] } | SwarmTask[];
      tasks = Array.isArray(data) ? data : (data.tasks ?? []);
    } catch {
      return; // transient; keep polling
    }
    if (!alive) return;

    // The conductor's active tasks = its queue (backlog). Newest first, capped for legibility.
    const active = tasks
      .filter((t) => ACTIVE.has(norm(t.status)))
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, MAX_ACTIVE);

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
      if (COMPLETE.has(norm(t.status)) && phaseOf.has(id) && phaseOf.get(id) !== "done") {
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
