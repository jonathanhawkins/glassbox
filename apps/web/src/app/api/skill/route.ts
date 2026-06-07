import { proxyGet } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/skill?task=tokenizer -> the task's planner skill mirror
 * { current, covered, order, unit, versions: [{version, covered, text}] }.
 *
 * Proxies the backend GET /skill?task=, which reads the requested task's skill on
 * demand (so the kata and the tokenizer each return their own groups + history),
 * rather than the single tokenizer-only Redis mirror.
 */
export async function GET(request: Request) {
  const task = new URL(request.url).searchParams.get("task") || "tokenizer";
  return proxyGet(`/skill?task=${encodeURIComponent(task)}`);
}
