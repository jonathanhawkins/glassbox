import { proxyGet } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/status -> proxies to the backend GET /status.
 * Returns { running } so the cockpit can light up / dim the header Stop button.
 */
export async function GET() {
  return proxyGet("/status");
}
