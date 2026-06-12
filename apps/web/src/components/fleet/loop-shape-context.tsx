"use client";

// Live loop-shape status, provided by SwarmView around the board so the
// OnTheCanvas overlay (SwarmRoutingEdges) can draw the active shape's return
// edge and gauge. Context (not props) because tldraw's component slots take no
// props; the provider sits above <Tldraw> and the slot reads it from inside.

import { createContext, useContext } from "react";

export type LoopShapeStatus = {
  /** Active loop-shape id (a LOOP_SHAPES key) or null when no loop has run. */
  id: string | null;
  running: boolean;
  round: number;
  maxRounds: number;
  /** "" while running, else done | max rounds | stopped | <error>. */
  reason: string;
  /** Live task counts from the conductor's task list (the gauge's numbers). */
  counts: { queued: number; working: number; done: number };
  /**
   * The live Climb metric for the edge gauge: the leaderboard reading plus the monitor's
   * baseline/best, so the edge can show the whole climb ("269 -> 141 ms"). Absent for
   * shapes without a metric.
   */
  metric?: {
    value: number | null;
    baseline: number | null;
    best: number | null;
    /** "" for a unitless metric (accuracy); "ms" for a latency climb. */
    unit: string;
    higherIsBetter: boolean;
  };
};

export const LoopShapeContext = createContext<LoopShapeStatus | null>(null);

export function useLoopShape(): LoopShapeStatus | null {
  return useContext(LoopShapeContext);
}
