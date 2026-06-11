"use client";

// The board controller. It owns the imperative tldraw scene: it lays out the 8
// agent lanes once, then maps each live GlassboxEvent onto shape mutations and
// animations. It is intentionally framework-free (no React) so the Cockpit
// component can hand it the editor on mount and feed it events from the single
// EventSource subscription.

import { AGENTS } from "@glassbox/contract";
import type { GlassboxEvent } from "@glassbox/contract";
import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";

import type { AgentShape, BeadShape, DockShape } from "./shapes";
import {
  AGENT_POS,
  AGENT_ROLES,
  BACKLOG,
  BEAD_H,
  BEAD_W,
  BOARD_BOUNDS,
  CATEGORY_ORDER,
  DOCK_H,
  DOCK_W,
  DONE_RAIL,
  LANE_H,
  LANE_W,
  dockPos,
  dockSlotCentered,
  hasDock,
  type BeadDetail,
  type BeadState,
  type SkillState,
} from "./types";

const ANIM = { animation: { duration: 520 } } as const;
const ANIM_FAST = { animation: { duration: 320 } } as const;

type AnimateOpts = { animation: { duration: number } };

/**
 * Screen-space insets (px) for the floating HTML chrome that overlays the
 * canvas, so the board fits in the clear center and nothing hides under a dock.
 * These mirror the overlay geometry in CockpitBoard.tsx: left dock is
 * `left-5` + `w-[280px]`, right rail is `right-5` + `w-[380px]`, the header
 * runs along the top, and the docks sit `bottom-5`. The left and right insets
 * are dynamic (the copilot panel and the right rail each collapse), so only
 * `top`/`bottom` are read from here; see leftInset/rightInset and
 * setCopilotOpen/setRailOpen.
 */
const DOCK_INSETS = { left: 316, right: 416, top: 116, bottom: 28 } as const;

/** Breathing room between the docks and the framed board, in screen px. */
const FRAME_MARGIN = 24;

/**
 * On small windows the fixed dock insets would consume the whole viewport, so we
 * never let the insets eat more than this fraction of each axis. The board then
 * grows to fill whatever is left (sliding partly under the docks if it must)
 * instead of collapsing into a tiny cluster.
 */
const MAX_INSET_FRAC = { x: 0.62, y: 0.5 } as const;

/** Clamp the fitted zoom so the board neither vanishes nor balloons. */
const MIN_FIT_ZOOM = 0.06;
const MAX_FIT_ZOOM = 1.5;

// The left inset depends on the copilot panel (it overlays the canvas): reserve
// room for the open panel so the planner lane is never hidden under it, and only
// a thin margin when it is collapsed so the board fills the reclaimed width.
// setCopilotOpen() swaps between these and reframes.
const COPILOT_LEFT_OPEN = 384;
const COPILOT_LEFT_COLLAPSED = 56;

// The right inset depends on the controls/curve/leaderboard/feed/legend rail (it
// overlays the canvas): reserve room for the open rail so nothing hides under it,
// and only a thin margin when it is collapsed so the board fills the reclaimed
// width. setRailOpen() swaps between these and reframes.
const RAIL_RIGHT_OPEN = 416;
const RAIL_RIGHT_COLLAPSED = 56;

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Round-robin worker pool the coordinator routes to (mirrors agents/coordinator). */
const WORKER_POOL = ["worker-1", "worker-2", "worker-3", "worker-4"];

/**
 * How an active loop shape redraws the board: lane-role relabels (e.g. the
 * validator reads "judge: pick the winner" during a race) and whether the
 * workers fan into the centered column so attempts read as parallel lanes.
 * The fleet's per-shape specs (lib/fleet/loop-shapes.ts) provide these; the
 * controller stays archetype-agnostic.
 */
export type BoardLoopShape = {
  roles?: Record<string, string>;
  column?: boolean;
} | null;

/** Shorten a beads_rust id (e.g. "weavehacks4-sd0" -> "sd0") for the chip label. */
function shortId(beadId: string): string {
  const dash = beadId.lastIndexOf("-");
  const tail = dash >= 0 ? beadId.slice(dash + 1) : beadId;
  return tail || beadId;
}

/** Condense a bead title to 1-3 punchy words for the chip. */
function shortTitle(title: string | undefined, capability?: string): string {
  if (!title) return capability ?? "";
  const cleaned = title.replace(/[()]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  // Prefer the first meaningful words; drop tiny connectors.
  const keep = words.filter((w) => !["and", "the", "for", "to", "of", "a"].includes(w.toLowerCase()));
  return (keep.length ? keep : words).slice(0, 3).join(" ");
}

type BeadRecord = {
  shapeId: TLShapeId;
  capability: string;
  /** Shortened chip title (for the bead label). */
  title: string;
  /** Full task title as the planner wrote it (for the inspector popover). */
  fullTitle: string;
  label: string;
  backlogSlot: number;
  doneSlot: number;
  /** The worker lane this bead is currently sitting on, if any. */
  worker?: string;
};

export class BoardController {
  private editor: Editor;
  private beadByBeadId = new Map<string, BeadRecord>();
  private agentShapeId = new Map<string, TLShapeId>();
  private dockShapeId = new Map<string, TLShapeId>();
  private activeWorkers = WORKER_POOL.length;
  private frameBoundsOverride: { x: number; y: number; w: number; h: number } | null = null;
  private workerPos: Record<string, { x: number; y: number }> | null = null;
  // Real-data mode: bead events still MOVE beads, but the simulation's scripted agent-status
  // side-effects (planner/coordinator/validator auto-"working") are suppressed, so statuses
  // come only from explicit agent_status events fed from live session/sub-agent data. The
  // original simulated cockpit never enables this, so it is unchanged.
  private realMode = false;
  // The active loop shape's board treatment (role relabels + column layout).
  private loopShape: BoardLoopShape = null;
  private workerResetTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per-bead "land it" timers. animateShape's final settle goes through the
  // lock-respecting update path, so a locked bead never gets snapped exactly onto
  // its target, and a rapid claim->done or a throttled animation frame can leave
  // it short of (or never moving toward) its dock. Each move arms a timer that
  // forces the exact landing once the animation window closes (see moveBead).
  private beadLandTimers = new Map<TLShapeId, ReturnType<typeof setTimeout>>();
  private nextBacklogSlot = 0;
  private nextDoneSlot = 0;
  private routeIdx = 0; // fallback round-robin when an event lacks a worker agent
  private resizeObserver?: ResizeObserver;
  private reframeTimer?: ReturnType<typeof setTimeout>;
  // Left screen-space inset (px) reserved for the copilot panel; updated by
  // setCopilotOpen so the camera frames the board clear of the panel.
  private leftInset = COPILOT_LEFT_OPEN;
  // Right screen-space inset (px) reserved for the controls/feed/legend rail;
  // updated by setRailOpen so the camera frames the board clear of the rail.
  private rightInset = RAIL_RIGHT_OPEN;

  // Callbacks the Cockpit overlay listens to for header readouts.
  onGoal?: (goal: string) => void;
  onPlannerVersion?: (v: number) => void;
  onFinished?: (accuracy: number | null) => void;
  onSkill?: (state: SkillState) => void;

  // Live planner-skill state derived from the event stream (for the skill strip).
  // `order`/`unit` default to the tokenizer's so a pre-hydration render matches
  // today's view; hydrateSkill swaps in the active task's groups on load and on
  // every task switch.
  private skill: SkillState = {
    version: 1,
    order: [...CATEGORY_ORDER],
    unit: "category",
    covered: [],
    accuracy: null,
    lastGap: null,
    lastAdded: null,
    failing: [],
  };

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /**
   * Resolve a bead id to its full task detail for the inspector popover, reading
   * the live shape state (so the state badge matches the board right now) and the
   * record's full title + current worker. Returns null for an unknown bead.
   */
  beadDetail(beadId: string): BeadDetail | null {
    const rec = this.beadByBeadId.get(beadId);
    if (!rec) return null;
    const shape = this.editor.getShape(rec.shapeId) as BeadShape | undefined;
    const state = (shape?.props.state as BeadState) ?? "backlog";
    return {
      beadId,
      label: rec.label,
      title: rec.fullTitle || rec.title,
      capability: rec.capability,
      state,
      worker: rec.worker,
    };
  }

  /** Push the current skill state to the overlay (copying the array fields). */
  private publishSkill() {
    this.onSkill?.({
      ...this.skill,
      order: [...this.skill.order],
      covered: [...this.skill.covered],
    });
  }

  /**
   * Seed the skill strip from GET /api/skill?task= + the leaderboard. Called on
   * mount and again whenever the active task switches, so the strip renders the
   * NEW task's group tiles (order/unit) and its covered/version/accuracy, instead
   * of carrying the previous task's coverage. `order`/`unit` come straight from
   * the task's skill mirror; if omitted (older callers) the current order is kept.
   */
  hydrateSkill(
    covered: string[],
    version: number,
    accuracy: number | null,
    order?: string[],
    unit?: string,
  ) {
    if (Array.isArray(order)) this.skill.order = order.map(String);
    if (typeof unit === "string" && unit) this.skill.unit = unit;
    this.skill.covered = covered.map(String);
    // A fresh task starts with a clean gap/added/failing readout; the live event
    // stream repopulates these as runs for the new task arrive.
    this.skill.lastGap = null;
    this.skill.lastAdded = null;
    this.skill.failing = [];
    this.skill.version = Number.isFinite(version) ? version : 1;
    this.skill.accuracy =
      accuracy !== null && Number.isFinite(accuracy) ? accuracy : null;
    this.publishSkill();
  }

  /** Build the static frame: the 8 agent lanes, all idle. Idempotent-ish. */
  layout() {
    this.editor.run(
      () => {
        this.clearAll();
        for (const agent of AGENTS) {
          const pos = this.posOf(agent);
          if (!pos) continue;
          // Each worker gets a dashed task dock beneath its lane (drawn first so
          // claimed beads stack on top of it).
          if (hasDock(agent)) {
            const dPos = dockPos(agent, this.posOf(agent));
            const dId = createShapeId(`dock:${agent}`);
            this.dockShapeId.set(agent, dId);
            this.editor.createShape<DockShape>({
              id: dId,
              type: "dock",
              x: dPos.x,
              y: dPos.y,
              isLocked: true,
              props: { w: DOCK_W, h: DOCK_H, worker: agent, active: false },
            });
          }
          const id = createShapeId(`agent:${agent}`);
          this.agentShapeId.set(agent, id);
          this.editor.createShape<AgentShape>({
            id,
            type: "agent",
            x: pos.x,
            y: pos.y,
            isLocked: true,
            props: {
              w: LANE_W,
              h: LANE_H,
              agent,
              role: this.roleOf(agent),
              status: "idle",
              mail: 0,
            },
          });
        }
      },
      { ignoreShapeLock: true },
    );
    this.arrangeWorkers();
    this.computeFrameBounds();
    this.frameCamera({ immediate: true });
  }

  /**
   * Frame the board so the whole scene is visible in the clear center by
   * default, then hand camera control back to the user (wheel to zoom, drag to
   * pan).
   *
   * Instead of tldraw's symmetric camera *constraints* (a single padding value
   * applied to every edge, which over-pads narrow windows into a tiny cluster
   * and ignores that our left/right docks are different widths), we fit the
   * board into the actual *clear rectangle*: the viewport minus the asymmetric
   * dock insets. The insets back off proportionally on small windows so the
   * board fills the space it has instead of collapsing. We then re-frame on
   * resize so it stays fitted as the window changes.
   */
  frameCamera(opts: { immediate?: boolean } = {}) {
    // Absolute zoom ladder for wheel / keyboard zoom (whole-board fit usually
    // lands somewhere in the middle of this range).
    this.editor.setCameraOptions({
      isLocked: false,
      panSpeed: 1,
      zoomSpeed: 1,
      zoomSteps: [MIN_FIT_ZOOM, 0.12, 0.25, 0.4, 0.6, 0.85, 1, 1.5, 2.5, 4],
      wheelBehavior: "zoom",
    });

    const clear = this.clearRect();
    if (!clear) return;

    // When a swarm shows fewer than all workers, frame just the active swarm (so the
    // removed lanes leave no empty space) instead of the full board bounds.
    const board = this.frameBoundsOverride ?? BOARD_BOUNDS;
    const z = clampNum(
      Math.min(clear.w / board.w, clear.h / board.h),
      MIN_FIT_ZOOM,
      MAX_FIT_ZOOM,
    );
    // Place the board's center at the clear rect's center. tldraw maps a page
    // point P to screen as (P + camera) * zoom, so camera = target/zoom - P.
    const x = clear.cx / z - (board.x + board.w / 2);
    const y = clear.cy / z - (board.y + board.h / 2);
    this.editor.setCamera(
      { x, y, z },
      opts.immediate ? { immediate: true } : { animation: { duration: 280 } },
    );

    this.watchResize();
  }

  /**
   * Center the camera on a single node and zoom in, so the user can step through the graph
   * (planner -> coordinator -> workers -> validator -> improver) and look at each node in turn.
   * Used by the node-cycler nav buttons.
   */
  focusAgent(agent: string) {
    const clear = this.clearRect();
    const p = this.posOf(agent);
    if (!clear || !p) return;
    const cx = p.x + LANE_W / 2;
    const cy = p.y + LANE_H / 2 + 40; // bias down so the node's beads/dock sit in frame too
    const z = 1.8; // zoom in well past whole-board fit so the focused node clearly stands out
    // Same projection as frameCamera: screen = (P + camera) * zoom, so camera = target/zoom - P.
    const x = clear.cx / z - cx;
    const y = clear.cy / z - cy;
    this.editor.setCamera({ x, y, z }, { animation: { duration: 320 } });
  }

  /**
   * Reserve more or less left inset for the copilot panel, then reframe. The
   * cockpit calls this when the user collapses or expands the panel so the graph
   * stays fully visible (and uses the reclaimed width when the panel is hidden).
   */
  setCopilotOpen(open: boolean) {
    this.leftInset = open ? COPILOT_LEFT_OPEN : COPILOT_LEFT_COLLAPSED;
    this.frameCamera();
  }

  /**
   * Reserve more or less right inset for the controls/feed/legend rail, then
   * reframe. The cockpit calls this when the user collapses or expands the rail
   * so the graph stays fully visible (and uses the reclaimed width when hidden).
   */
  setRailOpen(open: boolean) {
    this.rightInset = open ? RAIL_RIGHT_OPEN : RAIL_RIGHT_COLLAPSED;
    this.frameCamera();
  }

  /**
   * The viewport rectangle (screen px) that is clear of the floating docks, with
   * a margin. Dock insets scale down on small windows so the board never gets
   * squeezed to nothing. Returns null if the viewport is not measured yet.
   */
  private clearRect() {
    const vsb = this.editor.getViewportScreenBounds();
    if (!vsb || vsb.w < 1 || vsb.h < 1) return null;

    let { top, bottom } = DOCK_INSETS;
    let left = this.leftInset;
    let right = this.rightInset;
    const hSum = left + right;
    const hMax = vsb.w * MAX_INSET_FRAC.x;
    if (hSum > hMax) {
      const k = hMax / hSum;
      left *= k;
      right *= k;
    }
    const vSum = top + bottom;
    const vMax = vsb.h * MAX_INSET_FRAC.y;
    if (vSum > vMax) {
      const k = vMax / vSum;
      top *= k;
      bottom *= k;
    }

    const x = left + FRAME_MARGIN;
    const y = top + FRAME_MARGIN;
    const w = Math.max(80, vsb.w - left - right - FRAME_MARGIN * 2);
    const h = Math.max(80, vsb.h - top - bottom - FRAME_MARGIN * 2);
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  /** Re-fit the board whenever the canvas container resizes (debounced). */
  private watchResize() {
    if (this.resizeObserver || typeof ResizeObserver === "undefined") return;
    const container = this.editor.getContainer();
    if (!container) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.reframeTimer) clearTimeout(this.reframeTimer);
      this.reframeTimer = setTimeout(() => this.frameCamera(), 120);
    });
    this.resizeObserver.observe(container);
  }

  /** Remove every shape (agents + beads) and reset bookkeeping. */
  private clearAll() {
    const ids = Array.from(this.editor.getCurrentPageShapeIds());
    if (ids.length) {
      this.editor.run(() => this.editor.deleteShapes(ids), { ignoreShapeLock: true });
    }
    this.beadByBeadId.clear();
    this.agentShapeId.clear();
    this.dockShapeId.clear();
    for (const t of this.workerResetTimers.values()) clearTimeout(t);
    this.workerResetTimers.clear();
    for (const t of this.beadLandTimers.values()) clearTimeout(t);
    this.beadLandTimers.clear();
    this.nextBacklogSlot = 0;
    this.nextDoneSlot = 0;
    this.routeIdx = 0;
  }

  private backlogPos(slot: number) {
    const col = slot % BACKLOG.cols;
    const row = Math.floor(slot / BACKLOG.cols);
    return { x: BACKLOG.x + col * BACKLOG.gapX, y: BACKLOG.y + row * BACKLOG.gapY };
  }

  private donePos(slot: number) {
    const col = slot % DONE_RAIL.cols;
    const row = Math.floor(slot / DONE_RAIL.cols);
    return { x: DONE_RAIL.x + col * DONE_RAIL.gapX, y: DONE_RAIL.y + row * DONE_RAIL.gapY };
  }

  /**
   * Re-pack the backlog grid so chips occupy slots 0..n-1 with no holes. A bead
   * occupies the grid while it has no worker and has not reached the done rail
   * (doneSlot < 0); claimed/done beads are excluded. Order is preserved by current
   * backlogSlot so chips slide up to fill the gap a dispatched task left behind.
   */
  private compactBacklog() {
    const inBacklog = Array.from(this.beadByBeadId.values())
      .filter((r) => r.worker === undefined && r.doneSlot < 0)
      .sort((a, b) => a.backlogSlot - b.backlogSlot);
    inBacklog.forEach((r, i) => {
      if (r.backlogSlot !== i) {
        r.backlogSlot = i;
        const p = this.backlogPos(i);
        this.moveBead(r, p.x, p.y, ANIM_FAST);
      }
    });
    this.nextBacklogSlot = inBacklog.length;
  }

  private setAgentStatus(agent: string, status: string) {
    const id = this.agentShapeId.get(agent);
    if (!id) return;
    const shape = this.editor.getShape(id) as AgentShape | undefined;
    if (!shape) return;
    if (shape.props.status === status) return;
    this.editor.run(
      () =>
        this.editor.updateShape<AgentShape>({
          id,
          type: "agent",
          props: { status },
        }),
      { ignoreShapeLock: true },
    );
  }

  private setAllAgents(status: string) {
    for (const agent of this.agentShapeId.keys()) this.setAgentStatus(agent, status);
  }

  /**
   * Set the agent lane's mail-count badge. This replaces the old free-floating mail beads
   * (which piled up in the validator's done rail): coordination stays visible on the graph as
   * a small "mail N" chip on the node, while the message text lives in the activity log.
   */
  setMailCount(agent: string, n: number) {
    const id = this.agentShapeId.get(agent);
    if (!id) return;
    const shape = this.editor.getShape(id) as AgentShape | undefined;
    if (!shape || shape.props.mail === n) return;
    this.editor.run(
      () => this.editor.updateShape<AgentShape>({ id, type: "agent", props: { mail: n } }),
      { ignoreShapeLock: true },
    );
  }

  /**
   * Show only the first `n` worker lanes as active and dim the rest, so the board reflects
   * the swarm's chosen worker count. Persists across re-layouts (re-applied in layout()).
   */
  /** Turn on real-data mode (no simulated status side-effects). Used by the /swarm board. */
  setRealMode(on: boolean) {
    this.realMode = on;
  }

  setActiveWorkers(n: number) {
    this.activeWorkers = Math.max(1, Math.min(WORKER_POOL.length, Math.floor(n) || 1));
    this.refreshWorkerLayout();
  }

  /**
   * Redraw the board for a loop shape: relabel the lanes whose role reads
   * differently under this loop (the validator becomes "judge: pick the winner"
   * during a race) and, when the shape asks for it, fan the workers into the
   * centered column so competing attempts read as parallel lanes converging on
   * the judge. Pass null to restore the default board.
   */
  setLoopShape(shape: BoardLoopShape) {
    this.loopShape = shape;
    for (const agent of this.agentShapeId.keys()) this.applyRole(agent);
    this.refreshWorkerLayout();
  }

  /** The role line under an agent's name, honoring the active loop shape. */
  private roleOf(agent: string): string {
    return this.loopShape?.roles?.[agent] ?? AGENT_ROLES[agent] ?? "";
  }

  private applyRole(agent: string) {
    const id = this.agentShapeId.get(agent);
    if (!id) return;
    const role = this.roleOf(agent);
    const shape = this.editor.getShape(id) as AgentShape | undefined;
    if (!shape || shape.props.role === role) return;
    this.editor.run(
      () =>
        this.editor.updateShape<AgentShape>({ id, type: "agent", props: { role } }),
      { ignoreShapeLock: true },
    );
  }

  // Fewer than all workers (or a loop shape that wants parallel lanes) -> a centered
  // column (so the middle worker is straight on the spine); all four -> the 2x2 grid.
  private refreshWorkerLayout() {
    this.workerPos =
      this.activeWorkers < WORKER_POOL.length || this.loopShape?.column
        ? this.computeColumn(this.activeWorkers)
        : null;
    this.arrangeWorkers();
    this.computeFrameBounds();
    this.frameCamera();
  }

  private posOf(agent: string): { x: number; y: number } {
    return this.workerPos?.[agent] ?? AGENT_POS[agent];
  }

  // A centered vertical column of `n` workers between the coordinator and the validator, so
  // the middle worker sits straight on the spine and the others fan symmetrically above/below.
  private computeColumn(n: number): Record<string, { x: number; y: number }> {
    const bandL = AGENT_POS.coordinator.x + LANE_W;
    const bandR = AGENT_POS.validator.x;
    const colX = bandL + (bandR - bandL) / 2 - LANE_W / 2;
    const spine = AGENT_POS.coordinator.y + LANE_H / 2;
    const ROW = 244; // lane + dock + gap, so docks never overlap the next lane
    const map: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < n; i += 1) {
      const cy = spine + (i - (n - 1) / 2) * ROW;
      map[`worker-${i + 1}`] = { x: colX, y: cy - LANE_H / 2 };
    }
    return map;
  }

  // Move the active workers (lanes + docks + their beads) to the current layout and remove
  // the inactive lanes from view, so the board redraws to just the live swarm.
  private arrangeWorkers() {
    this.editor.run(
      () => {
        WORKER_POOL.forEach((worker, i) => {
          const aId = this.agentShapeId.get(worker);
          const dId = this.dockShapeId.get(worker);
          if (i < this.activeWorkers) {
            const p = this.posOf(worker);
            const d = dockPos(worker, p);
            if (aId) this.editor.updateShape({ id: aId, type: "agent", x: p.x, y: p.y, opacity: 1 });
            if (dId) this.editor.updateShape({ id: dId, type: "dock", x: d.x, y: d.y, opacity: 1 });
          } else {
            if (aId) this.editor.updateShape({ id: aId, type: "agent", opacity: 0 });
            if (dId) this.editor.updateShape({ id: dId, type: "dock", opacity: 0 });
          }
        });
      },
      { ignoreShapeLock: true },
    );
    // Re-center any beads sitting on the workers that just moved.
    for (let i = 0; i < this.activeWorkers; i += 1) {
      const worker = WORKER_POOL[i];
      const anchor = Array.from(this.beadByBeadId.values()).find((r) => r.worker === worker);
      if (anchor) this.placeOnWorker(anchor, worker, ANIM_FAST);
    }
  }

  // Frame just the active swarm (planner, coordinator, the active workers + docks, validator,
  // improver) when the layout differs from the full grid, so it reads tight with no gaps.
  private computeFrameBounds() {
    if (this.activeWorkers >= WORKER_POOL.length && !this.workerPos) {
      this.frameBoundsOverride = null;
      return;
    }
    const agents = [
      "planner",
      "coordinator",
      "validator",
      "improver",
      ...WORKER_POOL.slice(0, this.activeWorkers),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const a of agents) {
      const p = this.posOf(a);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + LANE_W);
      maxY = Math.max(maxY, p.y + LANE_H);
      if (hasDock(a)) {
        const d = dockPos(a, this.posOf(a));
        minY = Math.min(minY, d.y);
        maxX = Math.max(maxX, d.x + DOCK_W);
        maxY = Math.max(maxY, d.y + DOCK_H);
      }
    }
    if (!Number.isFinite(minX)) {
      this.frameBoundsOverride = null;
      return;
    }
    const PAD = 36;
    this.frameBoundsOverride = {
      x: minX - PAD,
      y: minY - PAD,
      w: maxX - minX + PAD * 2,
      h: maxY - minY + PAD * 2,
    };
  }

  private updateBeadState(rec: BeadRecord, state: BeadState) {
    this.editor.run(
      () =>
        this.editor.updateShape<BeadShape>({
          id: rec.shapeId,
          type: "bead",
          props: { state },
        }),
      { ignoreShapeLock: true },
    );
  }

  /**
   * Paint every bead that has reached the validated rail (doneSlot >= 0) by its
   * REAL per-category outcome from the latest grade, instead of greening the whole
   * rail on the event type alone. A bead whose capability the oracle still fails
   * stays "done" (blue: the work landed, but that category is not correct yet); a
   * bead whose category passes turns "passed" (green). A bead greens only on a
   * genuine match (accuracy > 0 and its category absent from the failing set), so
   * a partial run shows real progress (the categories that pass) without ever
   * looking fully green, and a full pass (accuracy 1.0, empty failing set) greens
   * the whole rail. This is the honest mapping of the exact-match oracle onto the
   * board: green means "this category matches ground truth", nothing less.
   */
  private gradeDoneBeads(failed: Set<string>, accuracy: number) {
    for (const rec of this.beadByBeadId.values()) {
      if (rec.doneSlot < 0) continue;
      const passed = accuracy > 0 && !failed.has(rec.capability);
      this.updateBeadState(rec, passed ? "passed" : "done");
    }
  }

  private moveBead(rec: BeadRecord, x: number, y: number, opts: AnimateOpts = ANIM) {
    this.editor.animateShape({ id: rec.shapeId, type: "bead", x, y }, opts);
    // Guarantee the landing. Beads are locked, and tldraw's animateShape settle
    // path skips locked shapes, so the bead is never snapped exactly onto its
    // target (and if the animation frames are throttled or a newer move arrives
    // first, it can be left well short, e.g. stuck back in the backlog). Once the
    // animation window closes, force the exact position through the lock so a task
    // always sits squarely in its dock box, never offset.
    const shapeId = rec.shapeId;
    const prev = this.beadLandTimers.get(shapeId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.beadLandTimers.delete(shapeId);
      const shape = this.editor.getShape(shapeId);
      if (!shape) return;
      if (Math.abs(shape.x - x) < 0.5 && Math.abs(shape.y - y) < 0.5) return;
      this.editor.run(
        () => this.editor.updateShape({ id: shapeId, type: "bead", x, y }),
        { ignoreShapeLock: true },
      );
    }, opts.animation.duration + 80);
    this.beadLandTimers.set(shapeId, t);
  }

  /** Create a bead chip in the backlog. Returns its record (existing if known). */
  private ensureBead(
    beadId: string,
    capability: string,
    title: string,
    state: BeadState = "backlog",
  ): BeadRecord {
    const existing = this.beadByBeadId.get(beadId);
    if (existing) return existing;
    const slot = this.nextBacklogSlot++;
    const pos = this.backlogPos(slot);
    const shapeId = createShapeId(`bead:${beadId}`);
    const label = shortId(beadId);
    const cleanTitle = shortTitle(title, capability);
    const rec: BeadRecord = {
      shapeId,
      capability,
      title: cleanTitle,
      fullTitle: title?.trim() || cleanTitle,
      label,
      backlogSlot: slot,
      doneSlot: -1,
    };
    this.beadByBeadId.set(beadId, rec);
    this.editor.run(
      () =>
        this.editor.createShape<BeadShape>({
          id: shapeId,
          type: "bead",
          x: pos.x,
          y: pos.y,
          isLocked: true,
          props: {
            w: BEAD_W,
            h: BEAD_H,
            beadId,
            label,
            title: cleanTitle,
            capability,
            state,
          },
        }),
      { ignoreShapeLock: true },
    );
    return rec;
  }

  /** Number of beads currently parked in this worker's dock (for the stack). */
  private workerBeadCount(worker: string): number {
    let n = 0;
    for (const rec of this.beadByBeadId.values()) {
      if (rec.worker === worker) n += 1;
    }
    return n;
  }

  /** Brighten / dim a worker's dock frame based on whether it holds a task. */
  private setDockActive(worker: string, active: boolean) {
    const id = this.dockShapeId.get(worker);
    if (!id) return;
    const shape = this.editor.getShape(id) as DockShape | undefined;
    if (!shape || shape.props.active === active) return;
    this.editor.run(
      () =>
        this.editor.updateShape<DockShape>({
          id,
          type: "dock",
          props: { active },
        }),
      { ignoreShapeLock: true },
    );
  }

  /** Park a bead into a worker's dock, stacking it under any tasks already there. */
  private placeOnWorker(rec: BeadRecord, worker: string, opts: AnimateOpts = ANIM) {
    rec.worker = worker;
    // Re-center the worker's WHOLE task stack inside its dock, so each task sits
    // fully within the dock area (a single task is centered, not hugging the top
    // edge). The just-claimed bead flies in with `opts`; siblings nudge fast.
    const own: BeadRecord[] = [];
    for (const r of this.beadByBeadId.values()) {
      if (r.worker === worker) own.push(r);
    }
    own.forEach((r, i) => {
      const c = dockSlotCentered(worker, i, own.length, this.posOf(worker));
      this.moveBead(r, c.x, c.y, r === rec ? opts : ANIM_FAST);
    });
    this.setDockActive(worker, true);
  }

  /** Drop a worker's dock back to idle once its last task has left. */
  private releaseDockIfEmpty(worker: string) {
    if (this.workerBeadCount(worker) === 0) this.setDockActive(worker, false);
  }

  private resolveWorker(ev: GlassboxEvent): string {
    const agent = ev.agent;
    if (agent && WORKER_POOL.includes(agent)) return agent;
    // Fallback: round-robin if the event did not name a worker lane.
    const w = WORKER_POOL[this.routeIdx % WORKER_POOL.length];
    this.routeIdx += 1;
    return w;
  }

  // --- the event switch ---------------------------------------------------

  apply(ev: GlassboxEvent) {
    switch (ev.type) {
      case "run_started": {
        this.layout();
        this.setAllAgents("idle");
        if (ev.title) this.onGoal?.(ev.title);
        if (typeof ev.planner_version === "number") this.onPlannerVersion?.(ev.planner_version);
        this.onFinished?.(null);
        // The coordinator wakes immediately to orchestrate the plan.
        this.setAgentStatus("coordinator", "working");
        // Reset the skill readout for the new run (keep covered until plan_started).
        if (typeof ev.planner_version === "number") this.skill.version = ev.planner_version;
        this.skill.accuracy = null;
        this.skill.lastGap = null;
        this.publishSkill();
        break;
      }

      case "plan_started": {
        this.setAgentStatus("planner", "working");
        const cov = ev.payload?.covered;
        if (Array.isArray(cov)) this.skill.covered = cov.map(String);
        if (typeof ev.planner_version === "number") this.skill.version = ev.planner_version;
        this.publishSkill();
        break;
      }

      case "bead_created": {
        const cap = String(ev.payload?.capability ?? "");
        if (ev.bead_id) this.ensureBead(ev.bead_id, cap, ev.title ?? "", "backlog");
        if (!this.realMode) this.setAgentStatus("planner", "working");
        // A created bead's capability is a category this plan covers (fallback if
        // plan_started lacked it). harness is structural, not a scoring tile.
        if (cap && cap !== "harness" && !this.skill.covered.includes(cap)) {
          this.skill.covered = [...this.skill.covered, cap];
          this.publishSkill();
        }
        break;
      }

      case "bead_claimed": {
        if (!ev.bead_id) break;
        const cap = String(ev.payload?.capability ?? "");
        const rec = this.ensureBead(ev.bead_id, cap, ev.title ?? "", "backlog");
        const worker = this.resolveWorker(ev);
        this.updateBeadState(rec, "claimed");
        this.placeOnWorker(rec, worker, ANIM_FAST);
        // The chip left the backlog grid; slide the rest up to close the gap.
        this.compactBacklog();
        this.setAgentStatus(worker, "working");
        // The worker working is real (a real sub-agent landed on this lane); the coordinator
        // status is the simulation's scripted side-effect, so suppress it in real-data mode.
        if (!this.realMode) this.setAgentStatus("coordinator", "working");
        // Settle into working a beat after it lands on the lane.
        window.setTimeout(() => {
          if (this.beadByBeadId.has(ev.bead_id as string)) {
            this.updateBeadState(rec, "working");
          }
        }, 360);
        break;
      }

      case "bead_done": {
        if (!ev.bead_id) break;
        const cap = String(ev.payload?.capability ?? "");
        const rec = this.ensureBead(ev.bead_id, cap, ev.title ?? "", "working");
        const worker = ev.agent && WORKER_POOL.includes(ev.agent) ? ev.agent : null;
        this.updateBeadState(rec, "done");
        // It leaves the worker's dock, so it no longer counts toward that
        // worker's stack (the next claim there starts from the top slot again).
        const leftDock = rec.worker;
        rec.worker = undefined;
        if (leftDock) this.releaseDockIfEmpty(leftDock);
        // Park it on the validated rail (heading toward the validator).
        if (rec.doneSlot < 0) rec.doneSlot = this.nextDoneSlot++;
        const p = this.donePos(rec.doneSlot);
        this.moveBead(rec, p.x, p.y, ANIM);
        // In case it went straight from backlog to done, keep the grid gap-free.
        this.compactBacklog();
        if (!this.realMode) this.setAgentStatus("validator", "working");
        if (worker) {
          // Flash the worker done, then ease it back to idle for the next bead.
          this.setAgentStatus(worker, "done");
          this.scheduleWorkerReset(worker);
        }
        break;
      }

      case "validation_passed": {
        const acc = numAccuracy(ev);
        // Paint the validated rail by the REAL per-category outcome, not by the
        // event type alone. A genuine pass carries no failing categories (and
        // accuracy 1.0), so every validated bead greens; the per-category rule
        // also means a stray sub-1.0 "passed" event could never green the whole
        // rail behind a partial score.
        this.gradeDoneBeads(failedCategorySet(ev), acc ?? 1);
        this.setAgentStatus("validator", "done");
        this.skill.failing = readFailing(ev);
        if (acc !== null) {
          this.onFinished?.(acc);
          this.skill.accuracy = acc;
        }
        this.publishSkill();
        break;
      }

      case "validation_failed": {
        const acc = numAccuracy(ev);
        const failedCats = (ev.payload?.failed_categories as string[]) ?? [];
        // Show the truth of a partial grade: the categories that genuinely pass
        // the oracle go green on the rail, the ones it still fails stay blue
        // (done, not passed). The run did NOT pass, so the validator lane reads
        // failed and the top gap bounces back as a fresh bead, never a green rail.
        this.gradeDoneBeads(failedCategorySet(ev), acc ?? 0);
        this.setAgentStatus("validator", "failed");
        // Bounce the failure back into the backlog as a fresh highlighted bead.
        const cap = failedCats[0] ?? "harness";
        const bounceId = `${ev.bead_id ?? "fail"}:retry:${Math.random().toString(36).slice(2, 6)}`;
        const rec = this.ensureBead(bounceId, cap, "retry", "failed");
        this.updateBeadState(rec, "failed");
        const failing = readFailing(ev);
        this.skill.failing = failing;
        if (acc !== null) {
          this.onFinished?.(acc);
          this.skill.accuracy = acc;
        }
        const topGap = failing[0];
        if (topGap)
          this.skill.lastGap = {
            category: topGap.category,
            accuracy: acc ?? 0,
            failed: topGap.failed,
          };
        else if (failedCats.length)
          this.skill.lastGap = { category: failedCats[0], accuracy: acc ?? 0 };
        this.publishSkill();
        break;
      }

      case "plan_gap_found": {
        // The Weave eval flagged a failing category: pulse it on the skill strip
        // and surface the full per-category breakdown ("what the improver found").
        this.setAgentStatus("planner", "working");
        this.setAgentStatus("improver", "working");
        const failing = readFailing(ev);
        if (failing.length) this.skill.failing = failing;
        const category = String(ev.payload?.category ?? "");
        const gacc = numAccuracy(ev);
        const failed =
          Number(ev.payload?.failed) ||
          failing.find((f) => f.category === category)?.failed ||
          0;
        if (category) {
          this.skill.lastGap = {
            category,
            accuracy: gacc ?? this.skill.accuracy ?? 0,
            failed,
          };
          this.skill.lastAdded = null;
          this.publishSkill();
        }
        break;
      }

      case "bead_injected": {
        const cap = String(ev.payload?.capability ?? ev.payload?.added_category ?? "harness");
        const injId = ev.bead_id ?? `inject:${Math.random().toString(36).slice(2, 7)}`;
        const rec = this.ensureBead(injId, cap, ev.title ?? "gap fill", "injected");
        this.updateBeadState(rec, "injected");
        this.setAgentStatus("improver", "working");
        break;
      }

      case "planner_rewrite": {
        if (typeof ev.planner_version === "number") this.onPlannerVersion?.(ev.planner_version);
        this.setAgentStatus("improver", "working");
        this.setAgentStatus("planner", "working");
        // Improver pulse settles after the rewrite.
        window.setTimeout(() => this.setAgentStatus("improver", "done"), 1400);
        // The skill grew: light up the newly added category on the strip.
        const added = ev.payload?.added_category;
        const rcov = ev.payload?.covered;
        if (Array.isArray(rcov)) this.skill.covered = rcov.map(String);
        else if (typeof added === "string" && !this.skill.covered.includes(added))
          this.skill.covered = [...this.skill.covered, added];
        this.skill.lastAdded = typeof added === "string" ? added : null;
        this.skill.lastGap = null;
        if (typeof added === "string")
          this.skill.failing = this.skill.failing.filter(
            (f) => f.category !== added,
          );
        if (typeof ev.planner_version === "number") this.skill.version = ev.planner_version;
        this.publishSkill();
        break;
      }

      case "run_finished": {
        const acc = numAccuracy(ev);
        this.setAgentStatus("coordinator", "done");
        this.setAllAgentsDoneSoft(acc);
        if (acc !== null) this.onFinished?.(acc);
        if (typeof ev.planner_version === "number") this.onPlannerVersion?.(ev.planner_version);
        if (acc !== null) this.skill.accuracy = acc;
        if (typeof ev.planner_version === "number") this.skill.version = ev.planner_version;
        this.publishSkill();
        break;
      }

      case "agent_status": {
        const status = String(ev.payload?.status ?? "");
        if (ev.agent && status) this.setAgentStatus(ev.agent, status);
        break;
      }

      case "log":
      default:
        break;
    }
  }

  private scheduleWorkerReset(worker: string) {
    const prev = this.workerResetTimers.get(worker);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      // Only reset to idle if the worker is not mid-claim on a newer bead.
      const id = this.agentShapeId.get(worker);
      if (!id) return;
      const shape = this.editor.getShape(id) as AgentShape | undefined;
      if (shape && shape.props.status === "done") this.setAgentStatus(worker, "idle");
      this.workerResetTimers.delete(worker);
    }, 900);
    this.workerResetTimers.set(worker, t);
  }

  private setAllAgentsDoneSoft(accuracy: number | null) {
    // On finish, the planner and coordinator read "done": they completed this
    // cycle's planning and routing (a completion signal, not a correctness claim).
    // The validator lane instead reflects the GRADE: a sub-1.0 run stays "failed"
    // (red), matching its validation_failed event and the exact-match bar, so a
    // partial cycle never ends with a green validator. Only a genuine pass (or an
    // unknown score, e.g. an aborted run) reads "done".
    this.setAgentStatus("planner", "done");
    this.setAgentStatus("coordinator", "done");
    const validated = accuracy === null || accuracy >= 1;
    this.setAgentStatus("validator", validated ? "done" : "failed");
  }

  // --- hydration ----------------------------------------------------------

  /**
   * Seed the board from GET /api/beads on mount so a reload mid-run shows the
   * existing beads instead of an empty frame. Accepts the poller snapshot
   * ({ all: [...] }) or a bare array, both defensively.
   */
  hydrateBeads(snapshot: unknown) {
    const all = Array.isArray(snapshot)
      ? snapshot
      : ((snapshot as { all?: unknown[] } | null)?.all ?? []);
    if (!Array.isArray(all)) return;
    for (const raw of all) {
      const b = raw as {
        id?: string;
        title?: string;
        status?: string;
        body?: string;
        assignee?: string;
      };
      if (!b.id) continue;
      const cap = capFromBody(b.body) ?? "";
      const rec = this.ensureBead(b.id, cap, b.title ?? "", "backlog");
      if (b.status === "in_progress") {
        const worker = b.assignee && WORKER_POOL.includes(b.assignee) ? b.assignee : null;
        this.updateBeadState(rec, "working");
        if (worker) {
          this.placeOnWorker(rec, worker, ANIM_FAST);
          this.setAgentStatus(worker, "working");
        }
      } else if (b.status === "closed") {
        if (rec.doneSlot < 0) rec.doneSlot = this.nextDoneSlot++;
        const p = this.donePos(rec.doneSlot);
        this.moveBead(rec, p.x, p.y, ANIM_FAST);
        this.updateBeadState(rec, "done");
      }
    }
    // Beads pulled onto worker docks / the done rail vacated backlog slots while
    // seeding; pack the survivors so a mid-run reload renders a gap-free grid.
    this.compactBacklog();
  }

  dispose() {
    for (const t of this.workerResetTimers.values()) clearTimeout(t);
    this.workerResetTimers.clear();
    for (const t of this.beadLandTimers.values()) clearTimeout(t);
    this.beadLandTimers.clear();
    if (this.reframeTimer) clearTimeout(this.reframeTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }
}

function readFailing(
  ev: GlassboxEvent,
): { category: string; failed: number }[] {
  const raw = ev.payload?.failing;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => ({
      category: String((f as { category?: unknown })?.category ?? ""),
      failed: Number((f as { failed?: unknown })?.failed) || 0,
    }))
    .filter((f) => f.category);
}

/**
 * The set of categories the latest grade still fails, unioned from the event's
 * `failed_categories` list and the per-group `failing` breakdown. The board uses
 * this to green only the genuinely-passing beads on a validated rail (see
 * gradeDoneBeads), so a partial run is never painted uniformly green.
 */
function failedCategorySet(ev: GlassboxEvent): Set<string> {
  const set = new Set<string>();
  const fc = ev.payload?.failed_categories;
  if (Array.isArray(fc)) {
    for (const c of fc) if (typeof c === "string" && c) set.add(c);
  }
  for (const f of readFailing(ev)) set.add(f.category);
  return set;
}

function numAccuracy(ev: GlassboxEvent): number | null {
  const a = ev.payload?.accuracy;
  if (typeof a === "number" && Number.isFinite(a)) return a;
  // run_started/finished sometimes carry it nested; also parse "accuracy=0.83" titles.
  if (ev.title) {
    const m = /accuracy=([0-9.]+)/.exec(ev.title);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** Parse "capability=ascii" out of a bead body string (beads.py stores it there). */
function capFromBody(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const m = /capability=([a-z_]+)/i.exec(body);
  return m ? m[1] : undefined;
}
