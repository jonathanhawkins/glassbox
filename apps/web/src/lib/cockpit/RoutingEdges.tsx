"use client";

// Static routing edges drawn on the canvas (page space), behind the shapes.
// They show the swarm topology: planner -> coordinator -> the worker grid ->
// validator -> improver -> back to planner. Rendered via the tldraw
// `OnTheCanvas` component slot so they pan/zoom locked-in with the board.
//
// Routing principle: the worker docks (dashed TASKS boxes) sit directly between
// each worker lane and the mid-line, so a straight diagonal from the coordinator
// to a worker would slice through them (dash-on-dash clutter). Instead every
// worker edge is routed through the channels that are FREE of dock boxes -- the
// mid-line spine (y=SPINE_Y), the left/right gutters, and the narrow column gap
// between the two worker columns -- as smooth rounded "bus" paths. The result
// reads as one trunk out of the coordinator that splits to the four workers, and
// the four workers merging back into one trunk at the validator.

import { AGENT_POS, BOARD_BOUNDS, LANE_H, LANE_W } from "./types";

// --- geometry helpers -------------------------------------------------------

type Pt = { x: number; y: number };

const laneCenterY = (agent: string) => AGENT_POS[agent].y + LANE_H / 2;
const leftMid = (agent: string): Pt => ({ x: AGENT_POS[agent].x, y: laneCenterY(agent) });
const rightMid = (agent: string): Pt => ({ x: AGENT_POS[agent].x + LANE_W, y: laneCenterY(agent) });
const topMid = (agent: string): Pt => ({ x: AGENT_POS[agent].x + LANE_W / 2, y: AGENT_POS[agent].y });

// --- clean routing channels (all derived from AGENT_POS, all dock-free) ------

// The mid-line the single-lane agents sit on; also the clear horizontal spine
// that runs just below the top docks and above the bottom worker row.
const SPINE_Y = AGENT_POS.coordinator.y + LANE_H / 2;
const COORD_R = AGENT_POS.coordinator.x + LANE_W; // coordinator right edge
const VALID_L = AGENT_POS.validator.x; // validator left edge
const COL1_L = AGENT_POS["worker-1"].x; // near worker column, left edge
const COL1_R = COL1_L + LANE_W;
const COL2_L = AGENT_POS["worker-2"].x; // far worker column, left edge
const COL2_R = COL2_L + LANE_W;
// Vertical channels: the left gutter (coordinator -> near column), the right
// gutter (far column -> validator), and the gap between the two columns. The
// gap carries two opposing flows (dispatch up to the far column, collect down
// from the near column), so split it into two parallel lanes 8px apart.
const LEFT_GUTTER_X = (COORD_R + COL1_L) / 2;
const RIGHT_GUTTER_X = (COL2_R + VALID_L) / 2;
const GAP_C = (COL1_R + COL2_L) / 2;
const DISPATCH_GAP_X = GAP_C - 4;
const COLLECT_GAP_X = GAP_C + 4;

/**
 * Coordinator -> worker. Leaves the coordinator's right edge, runs the spine to
 * the gutter (near column) or column gap (far column), then rises/drops to the
 * worker's left edge. `far` = the second column (worker-2/worker-4), reached via
 * the gap so the path never crosses the near column's dock.
 */
function dispatchRoute(agent: string, far: boolean): Pt[] {
  const gx = far ? DISPATCH_GAP_X : LEFT_GUTTER_X;
  const wy = laneCenterY(agent);
  return [
    { x: COORD_R, y: SPINE_Y },
    { x: gx, y: SPINE_Y },
    { x: gx, y: wy },
    leftMid(agent),
  ];
}

/**
 * Worker -> validator, the mirror of dispatch. Leaves the worker's right edge to
 * the right gutter (near column = worker-2/worker-4) or the column gap (far
 * column = worker-1/worker-3), drops/rises to the spine, then runs to the
 * validator's left edge.
 */
function collectRoute(agent: string, far: boolean): Pt[] {
  const gx = far ? COLLECT_GAP_X : RIGHT_GUTTER_X;
  const wy = laneCenterY(agent);
  return [
    rightMid(agent),
    { x: gx, y: wy },
    { x: gx, y: SPINE_Y },
    { x: VALID_L, y: SPINE_Y },
  ];
}

// Forward-flow arrows sit just outside the worker lanes pointing east (into the
// worker on dispatch, away from it on collect), so direction reads at a glance.
const dispatchArrow = (agent: string) => ({ x: leftMid(agent).x - 7, y: laneCenterY(agent), angle: 0 });
const collectArrow = (agent: string) => ({ x: rightMid(agent).x + 7, y: laneCenterY(agent), angle: 0 });

const NEAR_WORKERS = ["worker-1", "worker-3"]; // near the coordinator
const FAR_WORKERS = ["worker-2", "worker-4"]; // near the validator

type Route = { key: string; pts: Pt[]; arrow: { x: number; y: number; angle: number } };

const WORKER_ROUTES: Route[] = [
  ...NEAR_WORKERS.map((w) => ({ key: `co-${w}`, pts: dispatchRoute(w, false), arrow: dispatchArrow(w) })),
  ...FAR_WORKERS.map((w) => ({ key: `co-${w}`, pts: dispatchRoute(w, true), arrow: dispatchArrow(w) })),
  ...FAR_WORKERS.map((w) => ({ key: `${w}-va`, pts: collectRoute(w, false), arrow: collectArrow(w) })),
  ...NEAR_WORKERS.map((w) => ({ key: `${w}-va`, pts: collectRoute(w, true), arrow: collectArrow(w) })),
];

// The clean horizontal hops at the ends of the pipeline (drawn edge-to-edge so
// only the gap between the two cards shows).
const STRAIGHT_EDGES: Array<[string, string]> = [
  ["planner", "coordinator"],
  ["validator", "improver"],
];

/**
 * Turn a list of waypoints into a smooth path: straight runs joined by short
 * quadratic fillets at each corner, so the orthogonal bus reads as soft rounded
 * elbows rather than hard right angles.
 */
function roundedPath(pts: Pt[], r = 11): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const ax = p1.x - ((p1.x - p0.x) / d1) * rr;
    const ay = p1.y - ((p1.y - p0.y) / d1) * rr;
    const bx = p1.x + ((p2.x - p1.x) / d2) * rr;
    const by = p1.y + ((p2.y - p1.y) / d2) * rr;
    d += ` L ${ax} ${ay} Q ${p1.x} ${p1.y} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * The self-improvement loop closes from improver back to planner. Drawn as an
 * arc that lifts above the whole pipeline (rather than a straight line slicing
 * back through the worker grid) so the feedback reads as a distinct return path.
 * Returns the path plus the apex point and tangent angle, so a direction arrow
 * can be planted at the top of the arc pointing back toward the planner.
 */
function feedbackArc() {
  const from = topMid("improver");
  const to = topMid("planner");
  // The side agents (improver, planner) sit on the worker+dock mid-line at the
  // same height as the lane tops, while the top worker row starts ~190px higher.
  // The arc's apex lands at roughly (from.y - 0.75*lift), so the lift has to be
  // big enough to carry that apex (and its shoulders) clear ABOVE the top worker
  // row, otherwise the return path slices straight through worker-1/worker-2.
  const lift = 320; // bows the apex to ~y=-10, above the top worker tops (y=40)
  const cy = Math.min(from.y, to.y) - lift;
  const d = `M ${from.x} ${from.y} C ${from.x} ${cy}, ${to.x} ${cy}, ${to.x} ${to.y}`;
  // Apex of the cubic at t=0.5; its tangent there is horizontal, running from the
  // improver (right) back toward the planner (left).
  const apex = { x: (from.x + to.x) / 2, y: (from.y + to.y + 6 * cy) / 8 };
  const angle = from.x > to.x ? 180 : 0;
  return { d, apex, angle };
}

/**
 * A small faint triangle pointing along +x, translated to (x, y) and rotated to
 * the flow direction. Shows which way work moves along an edge, faint enough to
 * hint direction without competing with the agent cards.
 */
function ArrowHead({
  x,
  y,
  angle,
  color,
}: {
  x: number;
  y: number;
  angle: number;
  color: string;
}) {
  return (
    <path
      d="M -3 -3.4 L 4.6 0 L -3 3.4 Z"
      fill={color}
      transform={`translate(${x} ${y}) rotate(${angle})`}
    />
  );
}

// Faint flow arrows: neutral gray along the forward pipeline, accent orange on
// the return loop (the self-improvement feedback is the story beat, so it earns
// the one vivid hue).
const FLOW_ARROW = "rgba(160,160,165,0.5)";
const LOOP_ARROW = "rgba(255,106,26,0.60)";

const EDGE_DASH = "3 6";
const EDGE_W = 2;

export function RoutingEdges({ hideLoop = false }: { hideLoop?: boolean } = {}) {
  const arc = feedbackArc();
  return (
    <svg
      width={BOARD_BOUNDS.w}
      height={BOARD_BOUNDS.h}
      viewBox={`0 0 ${BOARD_BOUNDS.w} ${BOARD_BOUNDS.h}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <defs>
        {/* userSpaceOnUse (not the default objectBoundingBox): a bbox gradient is
            degenerate on a perfectly horizontal line (zero-height box), which made
            the planner->coordinator and validator->improver hops render nearly
            invisible. Spanning the gradient across the board in page space gives
            every edge a solid stroke regardless of orientation, and reads as one
            calm neutral flow left to right (the orange is reserved for the
            return loop and live state). */}
        <linearGradient
          id="gb-edge"
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={0}
          x2={BOARD_BOUNDS.w}
          y2={0}
        >
          <stop offset="0%" stopColor="rgba(160,160,165,0.28)" />
          <stop offset="50%" stopColor="rgba(160,160,165,0.30)" />
          <stop offset="100%" stopColor="rgba(160,160,165,0.26)" />
        </linearGradient>
      </defs>

      {/* The improver -> planner self-improvement loop, arcing over the band, with
          a direction arrow at its apex pointing back toward the planner. Hidden when
          an active loop shape draws its own return edge (the overlay owns the loop). */}
      {!hideLoop && (
        <>
          <path
            d={arc.d}
            fill="none"
            stroke="rgba(255,106,26,0.28)"
            strokeWidth={EDGE_W}
            strokeLinecap="round"
            strokeDasharray="2 9"
          />
          <ArrowHead x={arc.apex.x} y={arc.apex.y} angle={arc.angle} color={LOOP_ARROW} />
        </>
      )}

      {/* Short horizontal pipeline hops at the ends (planner->coordinator,
          validator->improver), edge-to-edge through the gap between cards. */}
      {STRAIGHT_EDGES.map(([a, b]) => {
        const from = rightMid(a);
        const to = leftMid(b);
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        return (
          <g key={`${a}-${b}`}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="url(#gb-edge)"
              strokeWidth={EDGE_W}
              strokeLinecap="round"
              strokeDasharray={EDGE_DASH}
            />
            <ArrowHead x={mx} y={my} angle={0} color={FLOW_ARROW} />
          </g>
        );
      })}

      {/* Coordinator -> workers -> validator, routed through the dock-free
          channels (spine, gutters, column gap) as smooth rounded bus paths. */}
      {WORKER_ROUTES.map((route) => (
        <g key={route.key}>
          <path
            d={roundedPath(route.pts)}
            fill="none"
            stroke="url(#gb-edge)"
            strokeWidth={EDGE_W}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={EDGE_DASH}
          />
          <ArrowHead x={route.arrow.x} y={route.arrow.y} angle={route.arrow.angle} color={FLOW_ARROW} />
        </g>
      ))}
    </svg>
  );
}
