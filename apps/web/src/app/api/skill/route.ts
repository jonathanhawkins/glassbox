import { proxyGet } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/skill -> proxies to the backend GET /skill.
 * Returns { current, covered, versions: [{ version, path, covered }] } so the
 * cockpit can hydrate the planner-skill strip on load.
 */
export async function GET() {
  return proxyGet("/skill");
}
