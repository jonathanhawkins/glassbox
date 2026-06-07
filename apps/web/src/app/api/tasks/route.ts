import { proxyGet, proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tasks -> the swarm's available tasks with cheap metadata
 * [{ id, goal, unit, kind }]. Proxies the backend GET /tasks (which returns the
 * built-in curated tasks plus any bring-your-own-repo tasks). The cockpit's TASK
 * switcher renders from this; useTasks falls back to the curated pair on a 502.
 */
export async function GET() {
  return proxyGet("/tasks");
}

/**
 * POST /api/tasks -> create a bring-your-own-repo task. Proxies the backend
 * POST /tasks/byo, which clones the repo + discovers its failing test groups in
 * the background and returns the task metadata immediately (discovering: true).
 */
export async function POST(request: Request) {
  return proxyPost("/tasks/byo", request);
}
