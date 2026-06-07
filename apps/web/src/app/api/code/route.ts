import { proxyGet } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/code?task=tokenizer -> the task's workspace source code
 * { ts, task, edit_targets, unit, current: {rel: text},
 *   versions: [{version, files: {rel: text}, covered, accuracy}] }.
 *
 * Proxies the backend GET /workspace?task=, which reads the live workspace files
 * plus every per-version snapshot on demand, so the cockpit can show the real code
 * the swarm wrote and step v1..vN. An unknown task relays a 404 (via _require_task).
 */
export async function GET(request: Request) {
  const task = new URL(request.url).searchParams.get("task") || "tokenizer";
  return proxyGet(`/workspace?task=${encodeURIComponent(task)}`);
}
