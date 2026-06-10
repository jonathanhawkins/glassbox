import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/optimize -> proxies to the backend POST /optimize.
 * Runs the open-ended optimize loop: propose a new idea each round, keep only the
 * grader-verified gains, stop when genuinely stuck. Body example: { "max_versions": 12 }.
 */
export async function POST(request: Request) {
  return proxyPost("/optimize", request);
}
