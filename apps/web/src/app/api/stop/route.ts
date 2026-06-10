import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stop -> proxies to the backend POST /stop.
 * Cooperatively cancels the in-flight run: it halts at the next wave/version
 * boundary and releases the run lock. Returns { stopped } (whether a run was active).
 */
export async function POST(request: Request) {
  return proxyPost("/stop", request);
}
