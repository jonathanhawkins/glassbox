import { REDIS } from "@glassbox/contract";
import { getRedis } from "@/lib/redis";
import { proxyGet } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKILL_STATE = REDIS.skillState;

/**
 * GET /api/skill -> the planner skill mirror
 * { current, covered, versions: [{version, covered, text}] }.
 *
 * Reads the live Redis cache (glassbox:skill, written by the backend poller)
 * so the viewer shares the same source as the events/leaderboard. Falls back to
 * the backend GET /skill if the cache is missing (e.g. the poller has not run
 * yet or Redis is down), so the viewer always gets data.
 */
export async function GET() {
  try {
    const redis = getRedis();
    const raw = await redis.get(SKILL_STATE);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.versions)) {
        return Response.json(data);
      }
    }
  } catch {
    // fall through to the backend HTTP endpoint
  }
  return proxyGet("/skill");
}
