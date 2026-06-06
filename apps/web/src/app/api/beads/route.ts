import { REDIS } from "@glassbox/contract";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BEADS_STATE = REDIS.beadsState;

/**
 * GET /api/beads -> the current bead board.
 *
 * The swarm publishes a JSON snapshot (array of beads) to the glassbox:beads
 * redis string. We parse and return it as-is. Absent key or unparseable value
 * yields [] so the cockpit can render an empty board without erroring.
 */
export async function GET() {
  try {
    const redis = getRedis();
    const raw = await redis.get(BEADS_STATE);
    if (!raw) return Response.json([]);

    try {
      const parsed = JSON.parse(raw);
      return Response.json(parsed);
    } catch {
      // Stored value is not valid JSON; surface an empty board rather than 500.
      return Response.json([]);
    }
  } catch {
    return Response.json([]);
  }
}
