"use client";

// Custom tldraw shapes for the Glassbox cockpit: an AgentShape lane card and a
// BeadShape work node. Both are box shapes rendered with plain HTML so we can
// use Tailwind-ish inline styles and CSS transitions for the status pulse and
// the bead color/ring transitions. The board controller (board.ts) creates and
// mutates these programmatically; the user never draws them.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";

import {
  AGENT_ROLES,
  BEAD_H,
  BEAD_W,
  DOCK_H,
  DOCK_W,
  LANE_H,
  LANE_W,
  STATUS_COLORS,
  capColor,
  type BeadState,
} from "./types";

// Register our two custom shapes with tldraw's compile-time type system.
// Augmenting TLGlobalShapePropsMap adds each shape `type` to the `TLShape`
// union (mapping it to its props), so the editor's generic create/update/animate
// methods and BaseBoxShapeUtil accept our shapes with no casts. This is the
// documented v5 pattern; it requires @tldraw/tlschema to be resolvable, which it
// is (a direct devDependency of this app).
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    agent: {
      w: number;
      h: number;
      agent: string;
      role: string;
      status: string;
    };
    dock: {
      w: number;
      h: number;
      worker: string;
      active: boolean;
    };
    bead: {
      w: number;
      h: number;
      beadId: string;
      label: string;
      title: string;
      capability: string;
      state: string;
    };
  }
}

// --- AgentShape -----------------------------------------------------------

export type AgentShape = TLBaseShape<
  "agent",
  {
    w: number;
    h: number;
    agent: string;
    role: string;
    status: string;
  }
>;

export class AgentShapeUtil extends BaseBoxShapeUtil<AgentShape> {
  static override type = "agent" as const;

  static override props: RecordProps<AgentShape> = {
    w: T.number,
    h: T.number,
    agent: T.string,
    role: T.string,
    status: T.string,
  };

  override getDefaultProps(): AgentShape["props"] {
    return { w: LANE_W, h: LANE_H, agent: "agent", role: "", status: "idle" };
  }

  // Read-only visualization: never selectable / editable / resizable by users.
  override canResize() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override hideSelectionBoundsBg() {
    return true;
  }
  override canEdit() {
    return false;
  }

  override getGeometry(shape: AgentShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override getIndicatorPath(shape: AgentShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override component(shape: AgentShape) {
    const { agent, role, status, w, h } = shape.props;
    const light = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? "#6e6e73";
    const isWorking = status === "working";
    const roleLabel = role || AGENT_ROLES[agent] || "";
    return (
      <HTMLContainer>
        <div
          role="button"
          tabIndex={0}
          title={`inspect ${agent}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (typeof window !== "undefined")
              window.dispatchEvent(
                new CustomEvent("glassbox:agent-click", {
                  detail: { agent, x: e.clientX, y: e.clientY },
                }),
              );
          }}
          style={{
            width: w,
            height: h,
            boxSizing: "border-box",
            cursor: "pointer",
            borderRadius: 10,
            border: `1px solid ${isWorking ? "rgba(255,106,26,0.55)" : "rgba(255,255,255,0.08)"}`,
            background:
              "linear-gradient(160deg, rgba(28,28,31,0.94), rgba(17,17,19,0.94))",
            boxShadow: isWorking
              ? "0 0 22px rgba(255,106,26,0.26), inset 0 1px 0 rgba(255,255,255,0.04)"
              : "0 6px 18px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03)",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            color: "#f5f5f4",
            fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
            pointerEvents: "all",
            transition: "border-color 240ms ease, box-shadow 240ms ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: 999,
                background: light,
                boxShadow: `0 0 10px ${light}`,
                flex: "0 0 auto",
                animation: isWorking ? "gb-pulse 1.1s ease-in-out infinite" : "none",
              }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: 0.3,
                color: "#f5f5f4",
              }}
            >
              {agent}
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#a1a1a6",
              letterSpacing: 0.2,
            }}
          >
            {roleLabel}
          </div>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1.2,
              color: light,
              opacity: 0.85,
            }}
          >
            {status}
          </div>
        </div>
      </HTMLContainer>
    );
  }
}

// --- DockShape ------------------------------------------------------------
// The dashed "task dock" that sits beneath each worker lane. Claimed beads land
// inside it so the ownership reads at a glance. Purely decorative: a framed drop
// zone, brightened while the worker is holding a task.

export type DockShape = TLBaseShape<
  "dock",
  {
    w: number;
    h: number;
    worker: string;
    active: boolean;
  }
>;

export class DockShapeUtil extends BaseBoxShapeUtil<DockShape> {
  static override type = "dock" as const;

  static override props: RecordProps<DockShape> = {
    w: T.number,
    h: T.number,
    worker: T.string,
    active: T.boolean,
  };

  override getDefaultProps(): DockShape["props"] {
    return { w: DOCK_W, h: DOCK_H, worker: "worker-1", active: false };
  }

  override canResize() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override hideSelectionBoundsBg() {
    return true;
  }
  override canEdit() {
    return false;
  }

  override getGeometry(shape: DockShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  override getIndicatorPath(shape: DockShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override component(shape: DockShape) {
    const { w, h, active } = shape.props;
    const edge = active ? "rgba(255,106,26,0.55)" : "rgba(255,255,255,0.10)";
    return (
      <HTMLContainer>
        <div
          style={{
            width: w,
            height: h,
            boxSizing: "border-box",
            borderRadius: 10,
            border: `1.5px dashed ${edge}`,
            background: active
              ? "rgba(255,106,26,0.05)"
              : "rgba(255,255,255,0.015)",
            boxShadow: active
              ? "inset 0 0 18px rgba(255,106,26,0.10)"
              : "none",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            padding: "5px 9px",
            color: active ? "rgba(255,106,26,0.80)" : "rgba(161,161,166,0.45)",
            fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
            fontSize: 9,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            pointerEvents: "none",
            transition: "border-color 240ms ease, background 240ms ease, color 240ms ease",
          }}
        >
          tasks
        </div>
      </HTMLContainer>
    );
  }
}

// --- BeadShape ------------------------------------------------------------

export type BeadShape = TLBaseShape<
  "bead",
  {
    w: number;
    h: number;
    beadId: string;
    label: string;
    title: string;
    capability: string;
    state: string;
  }
>;

const RING_BY_STATE: Record<BeadState, string> = {
  backlog: "rgba(161,161,166,0.40)", // neutral gray
  claimed: "#ff6a1a", // accent (active)
  working: "#ff6a1a", // accent (active)
  done: "#9aa0a6", // neutral light (settled)
  passed: "#5ba372", // pass green
  failed: "#d85a52", // fail red
  injected: "#ff8a3d", // accent-bright (hot / new)
};

export class BeadShapeUtil extends BaseBoxShapeUtil<BeadShape> {
  static override type = "bead" as const;

  static override props: RecordProps<BeadShape> = {
    w: T.number,
    h: T.number,
    beadId: T.string,
    label: T.string,
    title: T.string,
    capability: T.string,
    state: T.string,
  };

  override getDefaultProps(): BeadShape["props"] {
    return {
      w: BEAD_W,
      h: BEAD_H,
      beadId: "",
      label: "bead",
      title: "",
      capability: "ascii",
      state: "backlog",
    };
  }

  override canResize() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }
  override hideSelectionBoundsBg() {
    return true;
  }
  override canEdit() {
    return false;
  }

  override getGeometry(shape: BeadShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override getIndicatorPath(shape: BeadShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override component(shape: BeadShape) {
    const { beadId, label, title, capability, state, w, h } = shape.props;
    const color = capColor(capability);
    const ring = RING_BY_STATE[state as BeadState] ?? RING_BY_STATE.backlog;
    const isActive = state === "working" || state === "claimed" || state === "injected";
    const isFailed = state === "failed";
    const isPassed = state === "passed";
    // A click on a bead opens the task inspector. The board is locked and
    // programmatic, so instead of plumbing a React callback through tldraw's
    // shape tree we dispatch a window event (the bead id + click point) that the
    // cockpit listens for; it resolves the live task detail and shows the popover.
    // stopPropagation on pointer-down keeps the click from starting a canvas pan.
    const openInspector = (clientX: number, clientY: number) => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("glassbox:bead-click", {
          detail: { beadId, x: clientX, y: clientY },
        }),
      );
    };
    return (
      <HTMLContainer>
        <div
          role="button"
          tabIndex={0}
          title="View task details"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openInspector(e.clientX, e.clientY);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openInspector(r.left + r.width / 2, r.bottom);
            }
          }}
          style={{
            width: w,
            height: h,
            boxSizing: "border-box",
            borderRadius: 9,
            border: `2px solid ${ring}`,
            background: `linear-gradient(150deg, ${hexA(color, 0.22)}, rgba(17,17,19,0.95))`,
            boxShadow: isActive
              ? `0 0 16px ${hexA(ring, 0.5)}`
              : isPassed
                ? `0 0 12px ${hexA("#5ba372", 0.4)}`
                : isFailed
                  ? `0 0 12px ${hexA("#d85a52", 0.45)}`
                  : "0 4px 12px rgba(0,0,0,0.4)",
            padding: "6px 9px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 2,
            color: "#f5f5f4",
            fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
            pointerEvents: "all",
            cursor: "pointer",
            transition:
              "border-color 260ms ease, box-shadow 260ms ease, background 260ms ease",
            animation: state === "injected" ? "gb-pop 600ms ease-out" : "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: color,
                boxShadow: `0 0 6px ${color}`,
                flex: "0 0 auto",
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#f5f5f4",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {label}
            </span>
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#a1a1a6",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
        </div>
      </HTMLContainer>
    );
  }
}

/** Turn a #rrggbb color into an rgba() string with the given alpha. */
function hexA(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
