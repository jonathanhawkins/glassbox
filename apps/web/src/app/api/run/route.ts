import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/run -> proxies to the backend POST /run.
 * Body example: { "goal": "port the BPE tokenizer to Rust" }.
 */
export async function POST(request: Request) {
  return proxyPost("/run", request);
}
