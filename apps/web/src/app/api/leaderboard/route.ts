import { REDIS } from "@glassbox/contract";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANNER_SCORES = REDIS.plannerScores;
const PLANNER_META = REDIS.plannerMeta;

type LeaderboardRow = {
  version: number;
  accuracy: number;
  // Optional per-version metadata (the version-indexed companion hash). Present once
  // the swarm has graded/rewritten that version; absent rows still render (accuracy only).
  added_category?: string | null;
  wall_ms?: number;
  weave_eval_url?: string | null;
  status?: string;
  gap_source?: string;
  // Per-version category signal for the climb matrix. `covered` is the set of
  // categories scored/covered at this version (always present once graded);
  // `by_group` is the richer real pass tally per category (live runs only).
  covered?: string[];
  by_group?: Record<string, { passed?: number; total?: number }>;
};

/**
 * GET /api/leaderboard?task=tokenizer -> [{ version, accuracy, ...meta }] by version asc.
 *
 * Accuracy + ordering come from the per-task glassbox:planner_scores:{task} sorted set
 * (member = planner_version, score = accuracy), the authoritative climb. The optional
 * per-version detail (added category, efficiency, status, and the deep link to THIS
 * version's Weave Evaluation) is merged in from the glassbox:planner_meta:{task} hash so
 * the cockpit's ranked leaderboard survives a reload. Response stays a flat array, so the
 * curve and deck consumers (which read only version/accuracy) are unaffected.
 */
export async function GET(request: Request) {
  const task = new URL(request.url).searchParams.get("task") || "tokenizer";
  const scoresKey = `${PLANNER_SCORES}:${task}`;
  const metaKey = `${PLANNER_META}:${task}`;
  try {
    const redis = getRedis();
    const [flat, metaRaw] = await Promise.all([
      redis.zrange(scoresKey, 0, -1, "WITHSCORES"),
      redis.hgetall(metaKey),
    ]);

    // Parse the per-version metadata hash (field = version string, value = JSON blob).
    const meta = new Map<number, Record<string, unknown>>();
    for (const [field, blob] of Object.entries(metaRaw ?? {})) {
      const version = Number(field);
      if (!Number.isFinite(version)) continue;
      try {
        const rec = JSON.parse(blob);
        if (rec && typeof rec === "object") meta.set(version, rec);
      } catch {
        // skip a corrupt row rather than failing the whole leaderboard
      }
    }

    const rows: LeaderboardRow[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const version = Number(flat[i]);
      const accuracy = Number(flat[i + 1]);
      if (!Number.isFinite(version) || !Number.isFinite(accuracy)) continue;
      const m = meta.get(version) ?? {};
      rows.push({
        version,
        accuracy,
        added_category: (m.added_category as string | null) ?? null,
        wall_ms: typeof m.wall_ms === "number" ? m.wall_ms : undefined,
        weave_eval_url: (m.weave_eval_url as string | null) ?? null,
        status: typeof m.status === "string" ? m.status : undefined,
        gap_source: typeof m.gap_source === "string" ? m.gap_source : undefined,
        covered: Array.isArray(m.covered)
          ? (m.covered as unknown[]).filter((c): c is string => typeof c === "string")
          : undefined,
        by_group:
          m.by_group && typeof m.by_group === "object"
            ? (m.by_group as Record<string, { passed?: number; total?: number }>)
            : undefined,
      });
    }
    rows.sort((a, b) => a.version - b.version);

    return Response.json(rows);
  } catch {
    // Redis down or unreachable: degrade to an empty leaderboard rather than a
    // 500 so the cockpit keeps polling and recovers when redis returns.
    return Response.json([] as LeaderboardRow[]);
  }
}
