import { REDIS } from "@glassbox/contract";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANNER_SCORES = REDIS.plannerScores;

type LeaderboardRow = { version: number; accuracy: number };

/**
 * GET /api/leaderboard?task=tokenizer -> [{ version, accuracy }] by version asc.
 *
 * Reads the per-task glassbox:planner_scores:{task} sorted set where member =
 * planner_version (as a string) and score = accuracy, so the tokenizer and the
 * kata keep separate curves. ZRANGE WITHSCORES returns a flat [member, score, ...]
 * list ordered by score; we reshape and sort by version for a stable climb curve.
 */
export async function GET(request: Request) {
  const task = new URL(request.url).searchParams.get("task") || "tokenizer";
  const key = `${PLANNER_SCORES}:${task}`;
  try {
    const redis = getRedis();
    const flat = await redis.zrange(key, 0, -1, "WITHSCORES");

    const rows: LeaderboardRow[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const version = Number(flat[i]);
      const accuracy = Number(flat[i + 1]);
      if (Number.isFinite(version) && Number.isFinite(accuracy)) {
        rows.push({ version, accuracy });
      }
    }
    rows.sort((a, b) => a.version - b.version);

    return Response.json(rows);
  } catch {
    // Redis down or unreachable: degrade to an empty leaderboard rather than a
    // 500 so the cockpit keeps polling and recovers when redis returns.
    return Response.json([] as LeaderboardRow[]);
  }
}
