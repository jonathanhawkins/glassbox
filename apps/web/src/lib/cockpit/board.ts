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
  DOCK_H,
  DOCK_W,
  DONE_RAIL,
  LANE_H,
  LANE_W,
  dockPos,
  dockSlot,
  hasDock,
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
 * runs along the top, and the docks sit `bottom-5`.
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

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Round-robin worker pool the coordinator routes to (mirrors agents/coordinator). */
const WORKER_POOL = ["worker-1", "worker-2", "worker-3", "worker-4"];

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
  title: string;
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
  private workerResetTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextBacklogSlot = 0;
  private nextDoneSlot = 0;
  private routeIdx = 0; // fallback round-robin when an event lacks a worker agent
  private resizeObserver?: ResizeObserver;
  private reframeTimer?: ReturnType<typeof setTimeout>;
  // Left screen-space inset (px) reserved for the copilot panel; updated by
  // setCopilotOpen so the camera frames the board clear of the panel.
  private leftInset = COPILOT_LEFT_OPEN;

  // Callbacks the Cockpit overlay listens to for header readouts.
  onGoal?: (goal: string) => void;
  onPlannerVersion?: (v: number) => void;
  onFinished?: (accuracy: number | null) => void;
  onSkill?: (state: SkillState) => void;

  // Live planner-skill state derived from the event stream (for the skill strip).
  private skill: SkillState = {
    version: 1,
    covered: [],
    accuracy: null,
    lastGap: null,
    lastAdded: null,
    failing: [],
  };

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Push the current skill state to the overlay (copying the covered array). */
  private publishSkill() {
    this.onSkill?.({ ...this.skill, covered: [...this.skill.covered] });
  }

  /** Seed the skill strip from GET /api/skill + the leaderboard on mount. */
  hydrateSkill(covered: string[], version: number, accuracy: number | null) {
    this.skill.covered = covered.map(String);
    if (Number.isFinite(version)) this.skill.version = version;
    if (accuracy !== null && Number.isFinite(accuracy)) this.skill.accuracy = accuracy;
    this.publishSkill();
  }

  /** Build the static frame: the 8 agent lanes, all idle. Idempotent-ish. */
  layout() {
    this.editor.run(
      () => {
        this.clearAll();
        for (const agent of AGENTS) {
          const pos = AGENT_POS[agent];
          if (!pos) continue;
          // Each worker gets a dashed task dock beneath its lane (drawn first so
          // claimed beads stack on top of it).
          if (hasDock(agent)) {
            const dPos = dockPos(agent);
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
              role: AGENT_ROLES[agent] ?? "",
              status: "idle",
            },
          });
        }
      },
      { ignoreShapeLock: true },
    );
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

    const board = BOARD_BOUNDS;
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
   * Reserve more or less left inset for the copilot panel, then reframe. The
   * cockpit calls this when the user collapses or expands the panel so the graph
   * stays fully visible (and uses the reclaimed width when the panel is hidden).
   */
  setCopilotOpen(open: boolean) {
    this.leftInset = open ? COPILOT_LEFT_OPEN : COPILOT_LEFT_COLLAPSED;
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

    let { right, top, bottom } = DOCK_INSETS;
    let left = this.leftInset;
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

  private moveBead(rec: BeadRecord, x: number, y: number, opts: AnimateOpts = ANIM) {
    this.editor.animateShape({ id: rec.shapeId, type: "bead", x, y }, opts);
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
    const stack = this.workerBeadCount(worker) - 1; // this rec is now counted
    const c = dockSlot(worker, Math.max(0, stack));
    this.moveBead(rec, c.x, c.y, opts);
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
        this.setAgentStatus("planner", "working");
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
        this.placeOnWorker(rec, worker, ANIM);
        this.setAgentStatus(worker, "working");
        this.setAgentStatus("coordinator", "working");
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
        this.setAgentStatus("validator", "working");
        if (worker) {
          // Flash the worker done, then ease it back to idle for the next bead.
          this.setAgentStatus(worker, "done");
          this.scheduleWorkerReset(worker);
        }
        break;
      }

      case "validation_passed": {
        const acc = numAccuracy(ev);
        for (const rec of this.beadByBeadId.values()) {
          if (rec.doneSlot >= 0) this.updateBeadState(rec, "passed");
        }
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
        this.setAgentStatus("validator", "failed");
        // Bounce the failure back into the backlog as a fresh highlighted bead.
        const failedCats = (ev.payload?.failed_categories as string[]) ?? [];
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
        this.setAllAgentsDoneSoft();
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

  private setAllAgentsDoneSoft() {
    // On finish, leave idle lanes idle but mark the active pipeline as done.
    for (const agent of ["planner", "coordinator", "validator"]) {
      this.setAgentStatus(agent, "done");
    }
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
  }

  dispose() {
    for (const t of this.workerResetTimers.values()) clearTimeout(t);
    this.workerResetTimers.clear();
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
