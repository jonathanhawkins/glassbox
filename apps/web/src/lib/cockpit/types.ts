// Shared types and visual constants for the Glassbox cockpit board.
//
// The board is a pure visualization of the live SSE event stream. These
// constants pin down the capability palette, the agent roster, and the fixed
// page-space layout so the controller (board.ts) can place shapes
// deterministically and the overlays (legend, curve) stay in sync.

import type { AgentStatus, GlassboxEvent } from "@glassbox/contract";

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
 * planner -> coordinator -> the 2x2 worker grid -> validator -> improver. Each
 * worker owns a dashed task dock directly beneath its lane (see `dockPos`), so
 * the two worker rows are spaced apart to give those docks room. The single-lane
 * agents are vertically centered on the worker+dock band so the row still scans
 * as one flow.
 */
export const AGENT_POS: Record<string, { x: number; y: number }> = {
  planner: { x: 40, y: 230 },
  coordinator: { x: 290, y: 230 },
  "worker-1": { x: 540, y: 40 },
  "worker-2": { x: 744, y: 40 },
  "worker-3": { x: 540, y: 290 },
  "worker-4": { x: 744, y: 290 },
  validator: { x: 994, y: 230 },
  improver: { x: 1244, y: 230 },
};

/** The backlog grid (lower-left, under the planner) where new beads appear. */
export const BACKLOG = {
  x: 40,
  y: 348,
  cols: 2,
  gapX: BEAD_W + 16,
  gapY: BEAD_H + 14,
};

/** The "validated" grid (lower-right, under the validator) where done beads settle. */
export const DONE_RAIL = {
  x: 994,
  y: 348,
  cols: 2,
  gapX: BEAD_W + 16,
  gapY: BEAD_H + 12,
};

/** The whole framed board region (used to fit/zoom the camera). */
export const BOARD_BOUNDS = { x: 0, y: 0, w: 1480, h: 560 };

// --- Worker task docks ----------------------------------------------------
// Each worker lane owns a dashed dock directly beneath it. Claimed beads land
// inside that dock in a tidy vertical stack (one column, since the dock is lane
// width and a bead nearly fills it) instead of floating off the card with a
// diagonal offset. This makes "these tasks belong to this worker" unmistakable.

/** Dock footprint (page px). Width matches the lane; height holds ~2 beads. */
export const DOCK_W = LANE_W;
export const DOCK_H = 116;
/** Vertical gap between a worker lane and the top of its dock. */
export const DOCK_GAP = 12;
/** Inner padding of the dock and the gap between stacked beads. */
const DOCK_PAD = 10;
const DOCK_ROW_GAP = 8;

/** Which agents get a task dock (the worker pool). */
export function hasDock(agent: string): boolean {
  return agent.startsWith("worker-");
}

/** Top-left of a worker's dock zone, in page space. */
export function dockPos(worker: string): { x: number; y: number } {
  const p = AGENT_POS[worker] ?? AGENT_POS["worker-1"];
  return { x: p.x, y: p.y + LANE_H + DOCK_GAP };
}

/**
 * Where the bead in stack position `slot` lands inside a worker's dock: centered
 * horizontally, stacked top-down. Slots beyond the dock's visible height keep
 * stacking downward (rare; a worker usually holds a single task).
 */
export function dockSlot(worker: string, slot = 0): { x: number; y: number } {
  const d = dockPos(worker);
  return {
    x: d.x + (DOCK_W - BEAD_W) / 2,
    y: d.y + DOCK_PAD + slot * (BEAD_H + DOCK_ROW_GAP),
  };
}

/**
 * Where bead `slot` of a `count`-bead stack lands so the WHOLE stack is
 * vertically centered inside the dock (a single task sits in the middle of the
 * dock instead of hugging the top edge). Horizontal centering matches dockSlot,
 * so a task always reads as fully inside its worker's dock.
 */
export function dockSlotCentered(
  worker: string,
  slot: number,
  count: number,
): { x: number; y: number } {
  const d = dockPos(worker);
  const n = Math.max(1, count);
  const stackH = n * BEAD_H + (n - 1) * DOCK_ROW_GAP;
  const top = d.y + Math.max(DOCK_PAD, (DOCK_H - stackH) / 2);
  return {
    x: d.x + (DOCK_W - BEAD_W) / 2,
    y: top + slot * (BEAD_H + DOCK_ROW_GAP),
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
  lastGap: { category: string; accuracy: number; failed?: number } | null;
  lastAdded: string | null;
  // Per-category exact-match failures the latest eval found (the data-driven
  // signal behind which gap the improver fixes next). Biggest first.
  failing: { category: string; failed: number }[];
};

// --- Agent Mail (the swarm's conversation) --------------------------------

/**
 * Avatar color per agent lane for the Agent Mail drawer. Workers get distinct
 * cool tones; the per-message capability chip carries the category color
 * separately (see CAP_COLORS).
 */
export const AGENT_COLORS: Record<string, string> = {
  planner: "#a78bfa", // violet
  coordinator: "#fbbf24", // amber
  "worker-1": "#38bdf8",
  "worker-2": "#22d3ee",
  "worker-3": "#34d399",
  "worker-4": "#f472b6",
  validator: "#22c55e", // green
  improver: "#fb7185", // rose
  system: "#64748b",
  all: "#64748b",
};

export function agentColor(agent: string | undefined): string {
  if (agent && agent in AGENT_COLORS) return AGENT_COLORS[agent];
  return "#64748b";
}

/**
 * One agent-to-agent message, derived from an `agent_message` event. The swarm
 * emits these at real handoffs (planner->coordinator, coordinator->worker,
 * worker->validator, validator->improver, improver->planner); the drawer groups
 * them by planner version so the v1->v7 climb reads as a growing conversation.
 */
export type MailMessage = {
  ts: number;
  from: string;
  to: string;
  subject: string;
  body: string;
  kind: string;
  cap?: string;
  version: number;
  bead_id?: string | null;
  run_id: string;
};

/**
 * Project a raw event-like record onto a MailMessage, or null if it is not a
 * mail event. The single source of truth for the mapping, shared by the live
 * path (toMail, from a typed GlassboxEvent) and the /api/mail hydration route
 * (from raw stream JSON), so the two paths can never drift.
 */
export function projectMail(ev: Record<string, unknown>): MailMessage | null {
  if (ev.type !== "agent_message") return null;
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  return {
    ts: typeof ev.ts === "number" ? ev.ts : 0,
    from: typeof ev.agent === "string" ? ev.agent : "system",
    to: typeof p.to === "string" ? p.to : "all",
    subject:
      typeof p.subject === "string"
        ? p.subject
        : typeof ev.title === "string"
          ? ev.title
          : "",
    body: typeof p.body === "string" ? p.body : "",
    kind: typeof p.kind === "string" ? p.kind : "note",
    cap: typeof p.cap === "string" ? p.cap : undefined,
    version: typeof ev.planner_version === "number" ? ev.planner_version : 0,
    bead_id: typeof ev.bead_id === "string" ? ev.bead_id : null,
    run_id: typeof ev.run_id === "string" ? ev.run_id : "",
  };
}

/** Project an event onto a MailMessage, or null if it is not a mail event. */
export function toMail(ev: GlassboxEvent): MailMessage | null {
  return projectMail(ev as unknown as Record<string, unknown>);
}
