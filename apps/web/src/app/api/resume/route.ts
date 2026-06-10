import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/resume -> proxies to the backend POST /resume.
 * Releases a paused run so it continues from where it parked. Returns { resumed }.
 */
export async function POST(request: Request) {
  return proxyPost("/resume", request);
}
