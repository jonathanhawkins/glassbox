// Start (POST) or poll (GET) the marketing video's server-side Remotion render.
// See lib/marketing-render.ts for the single-job state machine.

import { getRenderJob, startRender } from "@/lib/marketing-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(getRenderJob());
}

export async function POST(): Promise<Response> {
  return Response.json(startRender());
}
