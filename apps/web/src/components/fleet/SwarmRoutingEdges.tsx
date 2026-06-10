"use client";

// Dynamic routing edges for the swarm board. Reads the ACTUAL agent shape positions from the
// editor so edges follow the live layout. When all four workers are shown it reuses the
// original clean 2x2 routing; when fewer workers are shown (a centered column) it draws clean
// orthogonal "bus" paths, coordinator -> left bus -> worker -> right bus -> validator, so the
// middle worker reads dead-straight and the others fan symmetrically.

import { useEditor, useValue } from "tldraw";

import { BOARD_BOUNDS, LANE_H, LANE_W } from "@/lib/cockpit/types";
import type { AgentShape } from "@/lib/cockpit/shapes";
import { RoutingEdges } from "@/lib/cockpit/RoutingEdges";

type P = { x: number; y: number };

const FLOW = "rgba(160,160,165,0.34)";
const LOOP = "rgba(255,106,26,0.32)";

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
  const agents = useValue(
    "swarm-agents",
    () => {
      const m: Record<string, { x: number; y: number; vis: boolean }> = {};
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type !== "agent") continue;
        const a = s as AgentShape;
        m[a.props.agent] = { x: a.x, y: a.y, vis: (a.opacity ?? 1) > 0.05 };
      }
      return m;
    },
    [editor],
  );

  const workers = Object.keys(agents)
    .filter((a) => a.startsWith("worker-") && agents[a].vis)
    .sort();

  // Full grid -> reuse the original clean 2x2 routing.
  if (workers.length >= 4) return <RoutingEdges />;

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

  if (im && pl) {
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
  );
}
