"use client";

// Static routing edges drawn on the canvas (page space), behind the shapes.
// They show the swarm topology: planner -> coordinator -> the worker grid ->
// validator -> improver -> back to planner. Rendered via the tldraw
// `OnTheCanvas` component slot so they pan/zoom locked-in with the board.

import {
  AGENT_POS,
  BOARD_BOUNDS,
  LANE_H,
  LANE_W,
} from "./types";

function center(agent: string) {
  const p = AGENT_POS[agent];
  return { x: p.x + LANE_W / 2, y: p.y + LANE_H / 2 };
}

function top(agent: string) {
  const p = AGENT_POS[agent];
  return { x: p.x + LANE_W / 2, y: p.y };
}

function edge(a: string, b: string) {
  const from = center(a);
  const to = center(b);
  return { from, to };
}

// Forward flow, left to right: planner -> coordinator -> worker grid ->
// validator -> improver. These are short straight hops along the pipeline.
const EDGES: Array<[string, string]> = [
  ["planner", "coordinator"],
  ["coordinator", "worker-1"],
  ["coordinator", "worker-2"],
  ["coordinator", "worker-3"],
  ["coordinator", "worker-4"],
  ["worker-1", "validator"],
  ["worker-2", "validator"],
  ["worker-3", "validator"],
  ["worker-4", "validator"],
  ["validator", "improver"],
];

/**
 * The self-improvement loop closes from improver back to planner. Drawn as an
 * arc that lifts above the whole pipeline (rather than a straight line slicing
 * back through the worker grid) so the feedback reads as a distinct return path.
 */
function feedbackPath() {
  const from = top("improver");
  const to = top("planner");
  // The side agents now sit on the worker+dock mid-line, so the arc has to lift
  // clear over the top worker row (which starts well above them) to read as a
  // distinct return path instead of slicing through the grid.
  const lift = 200; // how high above the band the arc bows
  const cy = Math.min(from.y, to.y) - lift;
  return `M ${from.x} ${from.y} C ${from.x} ${cy}, ${to.x} ${cy}, ${to.x} ${to.y}`;
}

export function RoutingEdges() {
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
        <linearGradient id="gb-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(56,189,248,0.05)" />
          <stop offset="50%" stopColor="rgba(56,189,248,0.30)" />
          <stop offset="100%" stopColor="rgba(167,139,250,0.18)" />
        </linearGradient>
      </defs>
      {/* The improver -> planner self-improvement loop, arcing over the band. */}
      <path
        d={feedbackPath()}
        fill="none"
        stroke="rgba(167,139,250,0.22)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="2 9"
      />
      {EDGES.map(([a, b], i) => {
        const { from, to } = edge(a, b);
        return (
          <line
            key={`${a}-${b}-${i}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="url(#gb-edge)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="2 7"
          />
        );
      })}
    </svg>
  );
}
