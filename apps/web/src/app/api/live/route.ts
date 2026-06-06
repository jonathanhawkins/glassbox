import { proxyPost } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/live -> proxies to the backend POST /live.
 * Body example: { "goal": "port the BPE tokenizer to Rust", "injections": 2 }.
 *
 * Drives the spot-a-gap inject beat (plan_gap_found + bead_injected), where the
 * swarm notices a missing capability mid-run and accuracy jumps after the patch.
 * Falls back to a clean 502 JSON when the backend is down (handled by proxyPost).
 */
export async function POST(request: Request) {
  return proxyPost("/live", request);
}
