import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/loop -> proxies to the backend POST /loop.
 * Body example: { "versions": 5 } to run the self-improvement climb N times.
 */
export async function POST(request: Request) {
  return proxyPost("/loop", request);
}
