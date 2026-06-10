import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pause -> proxies to the backend POST /pause.
 * Cooperatively holds the in-flight run at the next wave/version boundary; the
 * run keeps its lock and resumes in place via /api/resume. Returns { paused }.
 */
export async function POST(request: Request) {
  return proxyPost("/pause", request);
}
