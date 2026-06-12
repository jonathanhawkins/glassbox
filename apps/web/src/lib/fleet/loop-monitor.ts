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

// --- Climb: stop when the metric stops improving (plateau) -----------------------------------

export interface ClimbState {
  /** Best metric seen so far (NaN until the first reading establishes the baseline). */
  best: number;
  /** The metric improved past its baseline at least once (so a flat/maxed metric never plateaus). */
  climbed: boolean;
  /** Time-spaced no-improvement windows accumulated AFTER the metric had climbed. */
  stallStreak: number;
  /** When the current no-improvement window opened (epoch ms; anchors the spacing). */
  windowTs: number;
  /** "" while still climbing, "plateau" once the metric has stalled. */
  reason: string;
}

/** No-improvement windows before a climb counts as plateaued. */
export const CLIMB_STALL_STREAK = 3;

/**
 * Minimum spacing between counted stalls. The cockpit feeds the monitor on every counts/metric
 * poll (~2-3s apart), but a real swarm needs MINUTES between harness evals; counting raw polls
 * would declare a plateau seconds after the first improvement. Time-spacing makes the unit "a
 * minute with no improvement", so plateau = CLIMB_STALL_STREAK minutes of genuine stagnation.
 */
export const CLIMB_STALL_SPACING_MS = 60_000;

export function initClimb(): ClimbState {
  return { best: NaN, climbed: false, stallStreak: 0, windowTs: NaN, reason: "" };
}

/** One leaderboard observation feeding the Climb monitor. `metric` is null when no reading yet. */
export interface ClimbObservation {
  shapeId: string | null; // the armed shape
  metric: number | null; // the live metric (e.g. best accuracy, or best wall_ms)
  ts: number; // observation time (epoch ms) anchoring the stall spacing
}

/**
 * Advance the Climb monitor by one metric reading. Pure: returns the next state, never mutates.
 *
 * `higherIsBetter` is true for a metric you maximize (accuracy) and false for one you minimize
 * (wall_ms / latency). The FIRST reading is the baseline (not a climb). A genuine improvement past
 * the baseline records a new best and resets the stall clock. Once the metric has climbed at least
 * once, every CLIMB_STALL_SPACING_MS that passes without an improvement counts one stall;
 * CLIMB_STALL_STREAK of those is a plateau -> reason "plateau". A flat or already-maxed metric
 * never plateaus (it never climbed), so the loop falls back to the conductor rather than stopping
 * on a non-result.
 */
export function stepClimb(
  prev: ClimbState,
  obs: ClimbObservation,
  higherIsBetter = true,
): ClimbState {
  if (obs.shapeId !== "climb" || obs.metric == null || Number.isNaN(obs.metric)) return prev;
  const m = obs.metric;
  if (Number.isNaN(prev.best)) {
    return { best: m, climbed: false, stallStreak: 0, windowTs: obs.ts, reason: "" }; // baseline
  }
  const better = higherIsBetter ? m > prev.best : m < prev.best;
  if (better) {
    return { best: m, climbed: true, stallStreak: 0, windowTs: obs.ts, reason: "" }; // climbed
  }
  if (!prev.climbed) return prev; // never improved past the baseline: keep waiting, not a plateau
  if (!(obs.ts - prev.windowTs >= CLIMB_STALL_SPACING_MS)) return prev; // window still open
  const stallStreak = prev.stallStreak + 1;
  return {
    ...prev,
    stallStreak,
    windowTs: obs.ts,
    reason: stallStreak >= CLIMB_STALL_STREAK ? "plateau" : prev.reason,
  };
}
