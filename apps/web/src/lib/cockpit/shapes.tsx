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
    bead: {
      w: number;
      h: number;
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
    const light = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? "#475569";
    const isWorking = status === "working";
    const roleLabel = role || AGENT_ROLES[agent] || "";
    return (
      <HTMLContainer>
        <div
          style={{
            width: w,
            height: h,
            boxSizing: "border-box",
            borderRadius: 14,
            border: `1px solid ${isWorking ? "rgba(245,158,11,0.55)" : "rgba(148,163,184,0.22)"}`,
            background:
              "linear-gradient(160deg, rgba(30,41,59,0.92), rgba(15,23,42,0.92))",
            boxShadow: isWorking
              ? "0 0 22px rgba(245,158,11,0.30), inset 0 1px 0 rgba(255,255,255,0.05)"
              : "0 6px 18px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            color: "#e2e8f0",
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
                color: "#f1f5f9",
              }}
            >
              {agent}
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#94a3b8",
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

// --- BeadShape ------------------------------------------------------------

export type BeadShape = TLBaseShape<
  "bead",
  {
    w: number;
    h: number;
    label: string;
    title: string;
    capability: string;
    state: string;
  }
>;

const RING_BY_STATE: Record<BeadState, string> = {
  backlog: "rgba(148,163,184,0.45)",
  claimed: "#fbbf24",
  working: "#f59e0b",
  done: "#38bdf8",
  passed: "#22c55e",
  failed: "#ef4444",
  injected: "#e879f9",
};

export class BeadShapeUtil extends BaseBoxShapeUtil<BeadShape> {
  static override type = "bead" as const;

  static override props: RecordProps<BeadShape> = {
    w: T.number,
    h: T.number,
    label: T.string,
    title: T.string,
    capability: T.string,
    state: T.string,
  };

  override getDefaultProps(): BeadShape["props"] {
    return {
      w: BEAD_W,
      h: BEAD_H,
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
    const { label, title, capability, state, w, h } = shape.props;
    const color = capColor(capability);
    const ring = RING_BY_STATE[state as BeadState] ?? RING_BY_STATE.backlog;
    const isActive = state === "working" || state === "claimed" || state === "injected";
    const isFailed = state === "failed";
    const isPassed = state === "passed";
    return (
      <HTMLContainer>
        <div
          style={{
            width: w,
            height: h,
            boxSizing: "border-box",
            borderRadius: 12,
            border: `2px solid ${ring}`,
            background: `linear-gradient(150deg, ${hexA(color, 0.26)}, rgba(15,23,42,0.94))`,
            boxShadow: isActive
              ? `0 0 16px ${hexA(ring, 0.55)}`
              : isPassed
                ? `0 0 14px ${hexA("#22c55e", 0.45)}`
                : isFailed
                  ? `0 0 14px ${hexA("#ef4444", 0.5)}`
                  : "0 4px 12px rgba(0,0,0,0.4)",
            padding: "6px 9px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 2,
            color: "#e2e8f0",
            fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
            pointerEvents: "all",
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
                color: "#f1f5f9",
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
              color: "#cbd5e1",
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
