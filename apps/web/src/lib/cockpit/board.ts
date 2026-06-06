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

import type { AgentShape, BeadShape } from "./shapes";
import {
  AGENT_POS,
  AGENT_ROLES,
  BACKLOG,
  BEAD_H,
  BEAD_W,
  BOARD_BOUNDS,
  DONE_RAIL,
  LANE_H,
  LANE_W,
  laneCenter,
  type BeadState,
} from "./types";

const ANIM = { animation: { duration: 520 } } as const;
const ANIM_FAST = { animation: { duration: 320 } } as const;

type AnimateOpts = { animation: { duration: number } };

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
};

export class BoardController {
  private editor: Editor;
  private beadByBeadId = new Map<string, BeadRecord>();
  private agentShapeId = new Map<string, TLShapeId>();
  private workerResetTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextBacklogSlot = 0;
  private nextDoneSlot = 0;
  private routeIdx = 0; // fallback round-robin when an event lacks a worker agent

  // Callbacks the Cockpit overlay listens to for header readouts.
  onGoal?: (goal: string) => void;
  onPlannerVersion?: (v: number) => void;
  onFinished?: (accuracy: number | null) => void;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Build the static frame: the 8 agent lanes, all idle. Idempotent-ish. */
  layout() {
    this.editor.run(
      () => {
        this.clearAll();
        for (const agent of AGENTS) {
          const pos = AGENT_POS[agent];
          if (!pos) continue;
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
    this.frameCamera();
  }

  /** Lock the camera onto the fixed board region and disable user panning/zoom. */
  frameCamera() {
    this.editor.zoomToBounds(BOARD_BOUNDS, { inset: 48, animation: { duration: 0 } });
    this.editor.setCameraOptions({
      isLocked: true,
      panSpeed: 0,
      zoomSpeed: 0,
      wheelBehavior: "none",
      zoomSteps: [this.editor.getZoomLevel()],
    });
  }

  /** Remove every shape (agents + beads) and reset bookkeeping. */
  private clearAll() {
    const ids = Array.from(this.editor.getCurrentPageShapeIds());
    if (ids.length) {
      this.editor.run(() => this.editor.deleteShapes(ids), { ignoreShapeLock: true });
    }
    this.beadByBeadId.clear();
    this.agentShapeId.clear();
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
    return { x: DONE_RAIL.x, y: DONE_RAIL.y + slot * DONE_RAIL.gapY };
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
        break;
      }

      case "plan_started": {
        this.setAgentStatus("planner", "working");
        break;
      }

      case "bead_created": {
        const cap = String(ev.payload?.capability ?? "");
        if (ev.bead_id) this.ensureBead(ev.bead_id, cap, ev.title ?? "", "backlog");
        this.setAgentStatus("planner", "working");
        break;
      }

      case "bead_claimed": {
        if (!ev.bead_id) break;
        const cap = String(ev.payload?.capability ?? "");
        const rec = this.ensureBead(ev.bead_id, cap, ev.title ?? "", "backlog");
        const worker = this.resolveWorker(ev);
        this.updateBeadState(rec, "claimed");
        const c = laneCenter(worker);
        this.moveBead(rec, c.x, c.y, ANIM);
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
        if (acc !== null) this.onFinished?.(acc);
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
        if (acc !== null) this.onFinished?.(acc);
        break;
      }

      case "plan_gap_found": {
        // The planner spotted a missing category: drop a glowing injected bead.
        this.setAgentStatus("planner", "working");
        this.setAgentStatus("improver", "working");
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
        break;
      }

      case "run_finished": {
        const acc = numAccuracy(ev);
        this.setAgentStatus("coordinator", "done");
        this.setAllAgentsDoneSoft();
        if (acc !== null) this.onFinished?.(acc);
        if (typeof ev.planner_version === "number") this.onPlannerVersion?.(ev.planner_version);
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
          const c = laneCenter(worker);
          this.moveBead(rec, c.x, c.y, ANIM_FAST);
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
  }
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
