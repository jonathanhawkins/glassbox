// Shared types and visual constants for the Glassbox cockpit board.
//
// The board is a pure visualization of the live SSE event stream. These
// constants pin down the capability palette, the agent roster, and the fixed
// page-space layout so the controller (board.ts) can place shapes
// deterministically and the overlays (legend, curve) stay in sync.

import type { AgentStatus } from "@glassbox/contract";

/** The capability taxonomy carried on bead_created / bead_claimed payloads. */
export type Capability =
  | "ascii"
  | "punctuation"
  | "numbers"
  | "code"
  | "unicode"
  | "emoji"
  | "whitespace"
  | "harness";

/** A bead's visual lifecycle on the board (independent of beads_rust status). */
export type BeadState =
  | "backlog"
  | "claimed"
  | "working"
  | "done"
  | "passed"
  | "failed"
  | "injected";

/** Neon palette per capability. Used by the bead shapes and the legend. */
export const CAP_COLORS: Record<Capability, string> = {
  ascii: "#38bdf8", // sky
  punctuation: "#a78bfa", // violet
  numbers: "#34d399", // emerald
  code: "#f472b6", // pink
  unicode: "#fbbf24", // amber
  emoji: "#fb7185", // rose
  whitespace: "#22d3ee", // cyan
  harness: "#94a3b8", // slate (structural, does not score)
};

/** Short human label per capability for the legend. */
export const CAP_LABELS: Record<Capability, string> = {
  ascii: "ascii",
  punctuation: "punct",
  numbers: "numbers",
  code: "code",
  unicode: "unicode",
  emoji: "emoji",
  whitespace: "space",
  harness: "harness",
};

/** Fallback color for an unknown / missing capability tag. */
export const UNKNOWN_CAP_COLOR = "#64748b";

export function capColor(cap: string | undefined): string {
  if (cap && cap in CAP_COLORS) return CAP_COLORS[cap as Capability];
  return UNKNOWN_CAP_COLOR;
}

/** Status light colors for an agent lane. */
export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#475569", // slate-600
  working: "#f59e0b", // amber-500 (pulses)
  done: "#22c55e", // green-500
  failed: "#ef4444", // red-500
};

/** Role label shown under each agent name. */
export const AGENT_ROLES: Record<string, string> = {
  planner: "decompose goal",
  coordinator: "route work",
  "worker-1": "implement",
  "worker-2": "implement",
  "worker-3": "implement",
  "worker-4": "implement",
  validator: "grade vs oracle",
  improver: "close the gaps",
};

// --- Fixed page-space layout (tldraw page coordinates) --------------------
// The camera is locked to frame this region. Everything is laid out in a single
// coordinate system so beads can animate smoothly between lanes.

export const LANE_W = 188;
export const LANE_H = 96;

export const BEAD_W = 120;
export const BEAD_H = 46;

/**
 * Where each agent lane card sits, top-left corner in page space.
 *
 * The roster reads left-to-right as the live pipeline, mirroring the deck:
 * planner -> coordinator -> the 2x2 worker grid -> validator -> improver. The
 * single-lane agents are vertically centered on the worker grid's mid-line so
 * the whole row scans as one flow.
 */
export const AGENT_POS: Record<string, { x: number; y: number }> = {
  planner: { x: 40, y: 96 },
  coordinator: { x: 290, y: 96 },
  "worker-1": { x: 540, y: 40 },
  "worker-2": { x: 744, y: 40 },
  "worker-3": { x: 540, y: 152 },
  "worker-4": { x: 744, y: 152 },
  validator: { x: 994, y: 96 },
  improver: { x: 1244, y: 96 },
};

/** The backlog grid (lower-left, under the planner) where new beads appear. */
export const BACKLOG = {
  x: 40,
  y: 300,
  cols: 2,
  gapX: BEAD_W + 16,
  gapY: BEAD_H + 14,
};

/** The "validated" grid (lower-right, under the validator) where done beads settle. */
export const DONE_RAIL = {
  x: 994,
  y: 300,
  cols: 2,
  gapX: BEAD_W + 16,
  gapY: BEAD_H + 12,
};

/** The whole framed board region (used to fit/zoom the camera). */
export const BOARD_BOUNDS = { x: 0, y: 0, w: 1480, h: 580 };

/** Diagonal stagger (page px) when more than one bead sits on a worker. */
export const LANE_STACK = { dx: 10, dy: 9 } as const;

/**
 * Where a task bead lands when a worker is working it. The bead overlays the
 * lower body of the worker card (centered horizontally, tucked just under the
 * agent name + status light, which stay visible along the top) so it reads as
 * "this task belongs to this worker" instead of floating below the lane.
 * Multiple beads on the same worker fan out with a small diagonal stagger.
 */
export function laneCenter(agent: string, stack = 0): { x: number; y: number } {
  const p = AGENT_POS[agent] ?? AGENT_POS.coordinator;
  return {
    x: p.x + LANE_W / 2 - BEAD_W / 2 + stack * LANE_STACK.dx,
    y: p.y + LANE_H - BEAD_H - 10 + stack * LANE_STACK.dy,
  };
}

// --- Planner skill evolution (the capability strip) -----------------------

/**
 * The 7 SCORING categories in canonical climb order (mirrors
 * agents/skill.py CATEGORY_ORDER). The skill strip lights these up left to right
 * as the planner skill grows. `harness` is structural and intentionally absent.
 */
export const CATEGORY_ORDER: Capability[] = [
  "ascii",
  "punctuation",
  "numbers",
  "code",
  "unicode",
  "whitespace",
  "emoji",
];

/**
 * Live planner-skill state the board derives from the event stream and hands to
 * the PlannerSkillPanel. `covered` is a subset of CATEGORY_ORDER; `lastGap` is
 * the category the latest Weave eval flagged; `lastAdded` is the category the
 * latest improver rewrite added.
 */
export type SkillState = {
  version: number;
  covered: string[];
  accuracy: number | null;
  lastGap: { category: string; accuracy: number } | null;
  lastAdded: string | null;
};
