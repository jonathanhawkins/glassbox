// Real-swarm shape monitor (pure kernel). A SPAWNED swarm runs autonomously with no loop kernel,
// so the cockpit must DETECT the armed shape's stop condition from the live task-poll counts. This
// is the framework-free decision the SwarmView effect drives one observation at a time, lifted out
// so it is unit testable. v1 handles SWEEP (stop when the backlog drains to empty and stays empty);
// Land/Climb extend it next.

export interface SweepState {
  /** The backlog was non-empty at least once this run (so an initial empty does not count). */
  worked: boolean;
  /** Consecutive observations with an empty backlog (debounces the gap between drain waves). */
  emptyStreak: number;
  /** "" while running, "done" once the backlog has genuinely drained. */
  reason: string;
}

/** Sustained-empty observations (each ~ one 2s task poll) before a Sweep counts as drained. */
export const SWEEP_EMPTY_STREAK = 3;

export function initSweep(): SweepState {
  return { worked: false, emptyStreak: 0, reason: "" };
}

/** One task-poll observation feeding the monitor. */
export interface LoopObservation {
  shapeId: string | null; // the armed shape ("sweep", "land", ...)
  backlog: number; // queued + working
  done: number; // completed
}

/**
 * Advance the Sweep monitor by one observation. Pure: returns the next state, never mutates.
 *
 * - Any backlog -> the sweep is working (and reopens if it had previously drained).
 * - An empty backlog increments the streak; once it has SUSTAINED empty (debounced) with at least
 *   one completed task and the shape is Sweep, the backlog has drained -> reason "done".
 */
export function stepSweep(prev: SweepState, obs: LoopObservation): SweepState {
  if (obs.backlog > 0) {
    return { worked: true, emptyStreak: 0, reason: "" };
  }
  const emptyStreak = prev.emptyStreak + 1;
  const drained =
    obs.shapeId === "sweep" && prev.worked && obs.done > 0 && emptyStreak >= SWEEP_EMPTY_STREAK;
  return { worked: prev.worked, emptyStreak, reason: drained ? "done" : prev.reason };
}
