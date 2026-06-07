// The active-task taxonomy for the cockpit. The swarm runs more than one target
// through the same backend: "tokenizer" (a Rust BPE tokenizer graded by an exact
// oracle), "textkit" (a Python textkit library graded by pytest), and any number
// of bring-your-own-repo (BYO) tasks created at runtime. The cockpit owns which
// task is active and threads it into every launch + per-task fetch (leaderboard,
// skill). The task LIST is now dynamic (GET /api/tasks), so TaskName is an open
// string id; TASK_GOALS is a fallback table for the two built-in curated tasks.

// An open id, not a closed union: BYO tasks mint ids like "byo-1717800000" at
// runtime. The alias is kept so the many existing references keep compiling.
export type TaskName = string;

export const DEFAULT_TASK: TaskName = "tokenizer";

export type TaskKind = "curated" | "byo";

/** Per-task metadata mirroring the backend GET /tasks payload. */
export type TaskMeta = {
  id: string;
  label?: string;
  goal: string;
  unit?: string; // "category" | "module" | "test"
  kind: TaskKind;
  repo?: string; // BYO only: path or git URL
  test_command?: string; // BYO only
  editable?: string; // BYO only: glob
  discovering?: boolean; // backend has not run the suite once yet
};

/** Fallback default goals for the built-in curated tasks (not exhaustive). */
export const TASK_GOALS: Record<string, string> = {
  tokenizer: "port the BPE tokenizer to Rust",
  textkit: "build the textkit Python library",
};

/**
 * The default goal to prefill for a task: prefer the task's own metadata goal,
 * fall back to the built-in table, then to empty. Safe for arbitrary BYO ids
 * (which are absent from TASK_GOALS).
 */
export function defaultGoalFor(task: TaskName, meta?: TaskMeta): string {
  return meta?.goal ?? TASK_GOALS[task] ?? "";
}
