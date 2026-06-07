import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reset -> proxies to the backend POST /reset.
 * Clears the live demo state (events, leaderboard, beads) for a clean restart.
 */
export async function POST(request: Request) {
  return proxyPost("/reset", request);
}
