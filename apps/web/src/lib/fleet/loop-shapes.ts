// Per-shape board treatment: how the swarm graph redraws for each loop shape.
// The spine (planner -> coordinator -> workers -> validator -> improver) is the
// engine and never changes; what changes per shape is the RETURN EDGE (the loop
// itself), the gauge copy, and how a few lanes re-read. The overlay
// (SwarmRoutingEdges) consumes edge/labels/gauge; the BoardController consumes
// roles/column via SwarmView.

/** Where the loop's return edge runs, or none for one-shot shapes. */
export type LoopReturnEdge =
  | "to-coordinator" // validator -> coordinator: re-dispatch until the stop condition
  | "to-planner" // validator -> planner: re-plan each round
  | "ring" // a closed patrol ring around the whole pipeline (never stops)
  | "none"; // one round, no loop (the missing edge is the message)

export interface LoopShapeSpec {
  id: string;
  /** The return edge this shape draws. */
  edge: LoopReturnEdge;
  /** Label written at the return edge's apex (or top-center for ring/none). */
  edgeLabel: string;
  /** Chip shown when the loop reaches its genuine stop condition. */
  doneLabel: string;
  /** Lane-role relabels while this shape is active (agent -> role line). */
  roles?: Record<string, string>;
  /** Force the centered-column worker layout so attempts read as parallel lanes. */
  column?: boolean;
  /** Draw the stream inlet feeding the planner (watch). */
  inlet?: boolean;
  /** What the live gauge counts alongside the label. */
  gauge: "round" | "drain" | "finds" | "none";
}

export const LOOP_SHAPES: Record<string, LoopShapeSpec> = {
  land: {
    id: "land",
    edge: "to-coordinator",
    edgeLabel: "until verified done",
    doneLabel: "landed",
    roles: { validator: "verify done, or loop" },
    gauge: "round",
  },
  climb: {
    id: "climb",
    edge: "to-planner",
    edgeLabel: "while it improves",
    doneLabel: "plateau: best kept",
    roles: { validator: "measure the metric", improver: "push the best up" },
    gauge: "round",
  },
  hold: {
    id: "hold",
    edge: "ring",
    edgeLabel: "hold: repair drift",
    doneLabel: "released",
    roles: { validator: "check the invariant", improver: "repair the drift" },
    gauge: "round",
  },
  watch: {
    id: "watch",
    edge: "to-planner",
    edgeLabel: "each round: digest",
    doneLabel: "watch ended",
    roles: { planner: "ingest the stream", validator: "review the digest" },
    inlet: true,
    gauge: "round",
  },
  burst: {
    id: "burst",
    edge: "none",
    edgeLabel: "one round: fan out, synthesize",
    doneLabel: "burst complete",
    roles: { coordinator: "fan out + synthesize" },
    gauge: "none",
  },
  sweep: {
    id: "sweep",
    edge: "to-coordinator",
    edgeLabel: "until the backlog is empty",
    doneLabel: "backlog drained",
    roles: { planner: "enumerate the backlog", validator: "verify each wave" },
    gauge: "drain",
  },
  dig: {
    id: "dig",
    edge: "to-planner",
    edgeLabel: "until finds run dry",
    doneLabel: "dry: dig complete",
    roles: { planner: "aim the dig", validator: "confirm each find" },
    gauge: "finds",
  },
  race: {
    id: "race",
    edge: "none",
    edgeLabel: "parallel attempts, one judge",
    doneLabel: "winner picked",
    roles: { coordinator: "fan out the attempts", validator: "judge: pick the winner" },
    column: true,
    gauge: "none",
  },
};
