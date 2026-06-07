// The active-task taxonomy for the cockpit. The swarm runs more than one target
// through the same backend: "tokenizer" (a Rust BPE tokenizer graded by an exact
// oracle) and "textkit" (a Python textkit library graded by pytest). The cockpit
// owns which task is active and threads it into every launch + per-task fetch
// (leaderboard, skill). These constants are the single source of truth so the
// switcher, the launch bodies, and the default goals never drift.

export type TaskName = "tokenizer" | "textkit";

export const DEFAULT_TASK: TaskName = "tokenizer";

/** A sensible default goal per task, used to prefill the goal input. */
export const TASK_GOALS: Record<TaskName, string> = {
  tokenizer: "port the BPE tokenizer to Rust",
  textkit: "build the textkit Python library",
};
