"use client";

// Dynamic routing edges for the swarm board. Reads the ACTUAL agent shape positions from the
// editor so edges follow the live layout. When all four workers sit in the 2x2 grid it reuses
// the original clean routing; when they sit in a centered column (fewer workers, or a loop
// shape that fans attempts into parallel lanes) it draws clean orthogonal "bus" paths,
// coordinator -> left bus -> worker -> right bus -> validator.
//
// On top of that spine, the active LOOP SHAPE draws its own return edge. The loop is the
// identity of each shape, so the graph redraws per shape: land arcs validator -> coordinator
// (until verified done), climb and dig arc validator -> planner (re-plan each round), hold
// closes a patrol ring around the whole pipeline, watch adds the stream inlet feeding the
// planner, sweep arcs back with a drain counter, and burst/race draw NO return edge (one
// round is the message). Live round/counts render at the apex; the stop condition lands as
// an end chip (landed, plateau, winner picked) when the loop genuinely finishes.

import type { ReactNode } from "react";
import { useEditor, useValue } from "tldraw";

import { BOARD_BOUNDS, DOCK_GAP, DOCK_H, LANE_H, LANE_W } from "@/lib/cockpit/types";
import type { AgentShape } from "@/lib/cockpit/shapes";
import { RoutingEdges } from "@/lib/cockpit/RoutingEdges";
import { LOOP_SHAPES, type LoopShapeSpec } from "@/lib/fleet/loop-shapes";
import { useLoopShape, type LoopShapeStatus } from "./loop-shape-context";

type P = { x: number; y: number };
type AgentMap = Record<string, { x: number; y: number; vis: boolean }>;

const FLOW = "rgba(160,160,165,0.34)";
const LOOP = "rgba(255,106,26,0.32)";
const LOOP_STROKE = "rgba(255,106,26,0.38)";
const LOOP_TEXT = "rgba(255,138,61,0.92)"; // accent-bright: the loop is the story beat
const MUTED_TEXT = "rgba(161,161,166,0.78)";
const PASS = "#5ba372"; // a genuine stop condition reads pass green
const MUTED = "#9aa0a6"; // any other ending (stopped, max rounds) stays neutral

const MONO = "var(--font-geist-mono, ui-monospace, monospace)";

// Straight runs joined by short rounded fillets (collinear points collapse to a straight line).
function roundedPath(pts: P[], r = 12): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
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

export function SwarmRoutingEdges() {
  const editor = useEditor();
  const status = useLoopShape();
  const agents = useValue(
    "swarm-agents",
    () => {
      const m: AgentMap = {};
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type !== "agent") continue;
        const a = s as AgentShape;
        m[a.props.agent] = { x: a.x, y: a.y, vis: (a.opacity ?? 1) > 0.05 };
      }
      return m;
    },
    [editor],
  );

  const spec = status?.id ? LOOP_SHAPES[status.id] : undefined;
  const workers = Object.keys(agents)
    .filter((a) => a.startsWith("worker-") && agents[a].vis)
    .sort();

  // 2x2 grid (two distinct worker columns) -> the original clean routing underneath;
  // a single worker column (fewer workers, or a shape forcing parallel lanes) -> bus paths.
  const grid =
    workers.length >= 4 && new Set(workers.map((w) => Math.round(agents[w].x))).size > 1;

  const overlay =
    spec && status ? <LoopShapeOverlay agents={agents} spec={spec} status={status} /> : null;

  if (grid) {
    return (
      <>
        <RoutingEdges hideLoop={Boolean(spec)} />
        {overlay}
      </>
    );
  }

  const cy = (a: string) => (agents[a] ? agents[a].y + LANE_H / 2 : 0);
  const lx = (a: string) => (agents[a] ? agents[a].x : 0);
  const rx = (a: string) => (agents[a] ? agents[a].x + LANE_W : 0);

  const co = agents.coordinator;
  const va = agents.validator;
  const pl = agents.planner;
  const im = agents.improver;
  const spine = co ? cy("coordinator") : 0;

  const paths: { d: string; loop?: boolean }[] = [];
  if (pl && co)
    paths.push({
      d: roundedPath([
        { x: rx("planner"), y: cy("planner") },
        { x: lx("coordinator"), y: cy("coordinator") },
      ]),
    });
  if (va && im)
    paths.push({
      d: roundedPath([
        { x: rx("validator"), y: cy("validator") },
        { x: lx("improver"), y: cy("improver") },
      ]),
    });

  if (co && va && workers.length) {
    const colX = lx(workers[0]);
    const coordR = rx("coordinator");
    const valL = lx("validator");
    const leftBus = (coordR + colX) / 2;
    const rightBus = (colX + LANE_W + valL) / 2;
    for (const w of workers) {
      const wy = cy(w);
      paths.push({
        d: roundedPath([
          { x: coordR, y: spine },
          { x: leftBus, y: spine },
          { x: leftBus, y: wy },
          { x: colX, y: wy },
        ]),
      });
      paths.push({
        d: roundedPath([
          { x: colX + LANE_W, y: wy },
          { x: rightBus, y: wy },
          { x: rightBus, y: spine },
          { x: valL, y: spine },
        ]),
      });
    }
  }

  // The default improver -> planner self-improvement arc, only while no loop shape is
  // active (an active shape draws its own return edge in the overlay instead).
  if (im && pl && !spec) {
    const from = { x: im.x + LANE_W / 2, y: im.y };
    const to = { x: pl.x + LANE_W / 2, y: pl.y };
    let top = Infinity;
    for (const k of Object.keys(agents)) if (agents[k].vis) top = Math.min(top, agents[k].y);
    const acy = (Number.isFinite(top) ? top : from.y) - 110;
    paths.push({
      d: `M ${from.x} ${from.y} C ${from.x} ${acy}, ${to.x} ${acy}, ${to.x} ${to.y}`,
      loop: true,
    });
  }

  return (
    <>
      <svg
        width={BOARD_BOUNDS.w}
        height={BOARD_BOUNDS.h}
        viewBox={`0 0 ${BOARD_BOUNDS.w} ${BOARD_BOUNDS.h}`}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "visible" }}
      >
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={p.loop ? LOOP : FLOW}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.loop ? "2 9" : "3 6"}
          />
        ))}
      </svg>
      {overlay}
    </>
  );
}

// --- the loop-shape overlay -------------------------------------------------

/** A small triangle pointing along +x, translated and rotated to the flow direction. */
function Arrow({ x, y, angle, color }: { x: number; y: number; angle: number; color: string }) {
  return (
    <path
      d="M -3 -3.4 L 4.6 0 L -3 3.4 Z"
      fill={color}
      transform={`translate(${x} ${y}) rotate(${angle})`}
    />
  );
}

/** The shape's label (accent) with an optional live gauge line (muted) under it. */
function EdgeLabel({ x, y, text, sub }: { x: number; y: number; text: string; sub?: string }) {
  return (
    <g style={{ fontFamily: MONO }}>
      <text x={x} y={y} textAnchor="middle" fill={LOOP_TEXT} fontSize={11} letterSpacing={1}>
        {text}
      </text>
      {sub ? (
        <text x={x} y={y + 15} textAnchor="middle" fill={MUTED_TEXT} fontSize={10} letterSpacing={0.8}>
          {sub}
        </text>
      ) : null}
    </g>
  );
}

/** The end-state chip: the stop condition, landed ("landed ✓") or neutral ("stopped"). */
function EndChip({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 6.8 + 28;
  const h = 24;
  return (
    <g style={{ fontFamily: MONO }}>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={12}
        fill="rgba(17,17,19,0.92)"
        stroke={color}
        strokeOpacity={0.6}
        strokeWidth={1.5}
      />
      <text x={x} y={y + 3.5} textAnchor="middle" fill={color} fontSize={11} letterSpacing={0.8}>
        {text}
      </text>
    </g>
  );
}

/** Marching-dash animation (the loop visibly flowing) while the loop runs. */
function Marching({ period }: { period: number }) {
  return (
    <animate
      attributeName="stroke-dashoffset"
      from="0"
      to={String(-period * 4)}
      dur="2.4s"
      repeatCount="indefinite"
    />
  );
}

function LoopShapeOverlay({
  agents,
  spec,
  status,
}: {
  agents: AgentMap;
  spec: LoopShapeSpec;
  status: LoopShapeStatus;
}) {
  const vis = Object.entries(agents).filter(([, a]) => a.vis);
  if (!vis.length) return null;

  // Bounds of the visible swarm (lanes + worker docks), for the ring and label spots.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [name, a] of vis) {
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x + LANE_W);
    const depth = name.startsWith("worker-") ? LANE_H + DOCK_GAP + DOCK_H : LANE_H;
    maxY = Math.max(maxY, a.y + depth);
  }
  const midX = (minX + maxX) / 2;

  const topMid = (a: string): P | null =>
    agents[a]?.vis ? { x: agents[a].x + LANE_W / 2, y: agents[a].y } : null;

  const { running, reason, round, maxRounds, counts } = status;
  const ended = !running && reason !== "";
  // "done" (Sweep/Land) and "plateau" (Climb) are both the shape's GENUINE stop condition,
  // so both earn the green done-label chip; manual stops and errors stay muted prose.
  const genuine = reason === "done" || reason === "plateau";
  // A hold loop has no "done"; releasing it by hand is its natural ending.
  const endText = genuine
    ? `${spec.doneLabel} ✓`
    : spec.edge === "ring" && reason === "stopped"
      ? spec.doneLabel
      : reason;
  const endColor = genuine ? PASS : MUTED;

  const total = counts.queued + counts.working + counts.done;
  // Climb's gauge is the metric itself: "269 → 141 ms" once it has climbed (the whole run's
  // story at a glance), the lone best reading before that. Numbers come straight from the
  // monitor's baseline/best.
  const m = status.metric;
  const fmtM = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
  const metricGauge =
    m && m.best != null && m.baseline != null && m.best !== m.baseline
      ? `${fmtM(m.baseline)} → ${fmtM(m.best)}${m.unit ? ` ${m.unit}` : ""}`
      : m && (m.best ?? m.value) != null
        ? `best ${fmtM((m.best ?? m.value) as number)}${m.unit ? ` ${m.unit}` : ""}`
        : "";
  const gauge =
    spec.gauge === "drain"
      ? `drained ${counts.done}/${total}${round ? ` · round ${round}` : ""}`
      : spec.gauge === "finds"
        ? `${counts.done} found${round ? ` · round ${round}` : ""}`
        : spec.gauge === "metric"
          ? metricGauge
          : spec.gauge === "round" && round
            ? `round ${round}/${maxRounds}`
            : "";

  const parts: ReactNode[] = [];
  // Where the label / end chip sits; set per edge kind below.
  let anchor: P = { x: midX, y: minY - 56 };

  if (spec.edge === "to-coordinator" || spec.edge === "to-planner") {
    const from = topMid("validator");
    const to = topMid(spec.edge === "to-coordinator" ? "coordinator" : "planner");
    if (from && to) {
      const cy = minY - 120;
      const apex = { x: (from.x + to.x) / 2, y: (from.y + to.y + 6 * cy) / 8 };
      anchor = { x: apex.x, y: apex.y - 16 };
      // A genuinely-landed loop snaps its return edge off; other endings keep it, dimmed.
      if (!genuine) {
        parts.push(
          <g key="arc" opacity={ended ? 0.35 : 1}>
            <path
              d={`M ${from.x} ${from.y} C ${from.x} ${cy}, ${to.x} ${cy}, ${to.x} ${to.y}`}
              fill="none"
              stroke={LOOP_STROKE}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="2 9"
            >
              {running ? <Marching period={11} /> : null}
            </path>
            <Arrow x={apex.x} y={apex.y} angle={180} color={LOOP_TEXT} />
          </g>,
        );
      }
    }
  } else if (spec.edge === "ring") {
    const PAD = 34;
    const x = minX - PAD;
    const y = minY - PAD;
    const w = maxX - minX + PAD * 2;
    const h = maxY - minY + PAD * 2;
    const r = 20;
    // A path (not a rect) so the patrol dot can ride it with animateMotion.
    const d =
      `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} ` +
      `V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} ` +
      `A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    anchor = { x: midX, y: y - 18 };
    parts.push(
      <g key="ring" opacity={ended ? 0.35 : 1}>
        <path
          d={d}
          fill="none"
          stroke={LOOP_STROKE}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="4 7"
        >
          {running ? <Marching period={11} /> : null}
        </path>
        {running ? (
          <circle r={4} fill={LOOP_TEXT}>
            <animateMotion dur="7s" repeatCount="indefinite" path={d} />
          </circle>
        ) : null}
      </g>,
    );
  }
  // edge "none" (burst, race): no return path at all; the missing loop is the message.

  // The stream inlet feeding the planner (watch): the source the loop ingests each round.
  const pl = agents.planner;
  if (spec.inlet && pl?.vis) {
    const chipW = 104;
    const chipH = 34;
    const ix = pl.x - chipW - 48;
    const iy = pl.y + LANE_H / 2 - chipH / 2;
    const lineY = pl.y + LANE_H / 2;
    parts.push(
      <g key="inlet" style={{ fontFamily: MONO }}>
        <rect
          x={ix}
          y={iy}
          width={chipW}
          height={chipH}
          rx={10}
          fill="rgba(255,255,255,0.015)"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={1.5}
          strokeDasharray="5 5"
        />
        <text
          x={ix + chipW / 2}
          y={lineY + 3.5}
          textAnchor="middle"
          fill={MUTED_TEXT}
          fontSize={10}
          letterSpacing={1.6}
        >
          STREAM
        </text>
        <line
          x1={ix + chipW}
          y1={lineY}
          x2={pl.x - 7}
          y2={lineY}
          stroke={FLOW}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="3 6"
        >
          {running ? <Marching period={9} /> : null}
        </line>
        <Arrow x={pl.x - 6} y={lineY} angle={0} color={FLOW} />
      </g>,
    );
  }

  return (
    <svg
      width={BOARD_BOUNDS.w}
      height={BOARD_BOUNDS.h}
      viewBox={`0 0 ${BOARD_BOUNDS.w} ${BOARD_BOUNDS.h}`}
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "visible" }}
    >
      {parts}
      {ended ? (
        <EndChip x={anchor.x} y={anchor.y} text={endText} color={endColor} />
      ) : (
        <EdgeLabel x={anchor.x} y={anchor.y} text={spec.edgeLabel} sub={gauge || undefined} />
      )}
    </svg>
  );
}
