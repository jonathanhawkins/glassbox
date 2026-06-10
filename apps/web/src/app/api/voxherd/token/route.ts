// Hands the local browser the voxherd auth token so it can open the bridge WebSocket
// (which needs ?token= and HMAC-signed messages). Local dev only; the token never
// leaves the machine. Returns { token: null } when the bridge runs without auth.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (process.env.VOXHERD_AUTH_TOKEN) {
    return Response.json({ token: process.env.VOXHERD_AUTH_TOKEN });
  }
  try {
    const token = (await readFile(join(homedir(), ".voxherd", "auth_token"), "utf8")).trim();
    return Response.json({ token: token || null });
  } catch {
    return Response.json({ token: null });
  }
}
