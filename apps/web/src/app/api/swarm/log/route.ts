// Server-side, shared, survives-teardown record of each spawned swarm session's log.
//
// The voxherd sessions live in tmux and vanish the moment they are killed (the bridge drops
// last_summary on remove). So before/while a swarm runs we snapshot each node's summary +
// terminal preview into Redis, keyed by project. After teardown the sessions are gone but the
// logs are still readable here, from any tab/device, surviving a reload. localStorage stays as
// a fast client cache; this is the durable source of truth.
//
// Key: glassbox:swarm:log:{project}  (a HASH: field = node role, value = JSON snapshot)

import { REDIS } from "@glassbox/contract";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = REDIS.swarmLogPrefix; // "glassbox:swarm:log:"
const keyFor = (project: string) => `${PREFIX}${project}`;

export interface SwarmLogSnapshot {
  node: string; // planner | coordinator | worker-1 | validator | improver | ...
  sessionId?: string;
  summary?: string;
  preview?: string;
  activity?: string;
  status?: string;
  ts: number;
}

/** GET /api/swarm/log?project=web -> { project, nodes: { [node]: SwarmLogSnapshot } } */
export async function GET(request: Request): Promise<Response> {
  const project = new URL(request.url).searchParams.get("project") ?? "";
  if (!project) return Response.json({ project: "", nodes: {} });
  try {
    const raw = await getRedis().hgetall(keyFor(project));
    const nodes: Record<string, SwarmLogSnapshot> = {};
    for (const [node, blob] of Object.entries(raw ?? {})) {
      try {
        nodes[node] = JSON.parse(blob) as SwarmLogSnapshot;
      } catch {
        /* skip a corrupt row rather than failing the whole read */
      }
    }
    return Response.json({ project, nodes });
  } catch (e) {
    return Response.json(
      { project, nodes: {}, error: e instanceof Error ? e.message : "redis_error" },
      { status: 200 }, // never break the UI; an empty record is acceptable
    );
  }
}

/**
 * POST /api/swarm/log
 *   { project, node, summary?, preview?, activity?, status?, sessionId? }  // one node
 *   { project, snapshots: SwarmLogSnapshot[] }                              // or a batch
 * HSETs each snapshot under the project's hash.
 */
export async function POST(request: Request): Promise<Response> {
  let body: {
    project?: string;
    node?: string;
    sessionId?: string;
    summary?: string;
    preview?: string;
    activity?: string;
    status?: string;
    snapshots?: SwarmLogSnapshot[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const project = body.project ?? "";
  if (!project) return Response.json({ ok: false, error: "project_required" }, { status: 400 });

  const incoming: SwarmLogSnapshot[] = body.snapshots
    ? body.snapshots
    : body.node
      ? [
          {
            node: body.node,
            sessionId: body.sessionId,
            summary: body.summary,
            preview: body.preview,
            activity: body.activity,
            status: body.status,
            ts: Date.now(),
          },
        ]
      : [];
  const valid = incoming.filter((s) => s && typeof s.node === "string" && s.node);
  if (!valid.length) return Response.json({ ok: false, error: "no_snapshots" }, { status: 400 });

  try {
    const flat: string[] = [];
    for (const s of valid) flat.push(s.node, JSON.stringify({ ...s, ts: s.ts ?? Date.now() }));
    await getRedis().hset(keyFor(project), ...flat);
    return Response.json({ ok: true, saved: valid.length });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "redis_error" }, { status: 500 });
  }
}

/** DELETE /api/swarm/log?project=web -> clear the project's saved logs. */
export async function DELETE(request: Request): Promise<Response> {
  const project = new URL(request.url).searchParams.get("project") ?? "";
  if (!project) return Response.json({ ok: false, error: "project_required" }, { status: 400 });
  try {
    await getRedis().del(keyFor(project));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "redis_error" }, { status: 500 });
  }
}
