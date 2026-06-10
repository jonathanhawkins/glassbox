// Local proxy to the voxherd-bridge daemon (default http://localhost:7777).
//
// The browser never talks to the bridge directly: this keeps a single origin (no
// CORS) and the bearer token stays server-side. The catch-all path segment is
// forwarded verbatim to the bridge, e.g. GET /api/voxherd/api/sessions ->
// GET http://localhost:7777/api/sessions. Next.js 16: `params` is async.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = process.env.VOXHERD_BRIDGE_URL || "http://localhost:7777";

// The bridge token never changes during a session, but this proxy is hit on every
// session poll (1.5s x N mounted consumers). Reading the token file off disk on each
// request is wasted I/O on the hot path, so resolve it once and cache the result
// (including the "no token" outcome) for the lifetime of the server process.
let cachedToken: string | null | undefined;

async function bridgeToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  if (process.env.VOXHERD_AUTH_TOKEN) {
    cachedToken = process.env.VOXHERD_AUTH_TOKEN;
    return cachedToken;
  }
  try {
    cachedToken = (
      await readFile(join(homedir(), ".voxherd", "auth_token"), "utf8")
    ).trim();
  } catch {
    cachedToken = null; // no token file -> the bridge runs with auth disabled
  }
  return cachedToken;
}

type Ctx = { params: Promise<{ path?: string[] }> };

async function forward(method: string, req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const search = new URL(req.url).search;
  const target = `${BRIDGE}/${(path ?? []).join("/")}${search}`;
  const token = await bridgeToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // CSRF guard: the bridge (auth.py) rejects state-changing methods without a
    // custom X-VoxHerd header. It is a presence check, so any value satisfies it.
    "X-VoxHerd": "cockpit",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers, cache: "no-store" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await req.text();
  }
  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    return new Response(text || "{}", {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: "bridge_unreachable",
        target,
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}

export function GET(req: Request, ctx: Ctx) {
  return forward("GET", req, ctx);
}
export function POST(req: Request, ctx: Ctx) {
  return forward("POST", req, ctx);
}
export function DELETE(req: Request, ctx: Ctx) {
  return forward("DELETE", req, ctx);
}
export function PATCH(req: Request, ctx: Ctx) {
  return forward("PATCH", req, ctx);
}
