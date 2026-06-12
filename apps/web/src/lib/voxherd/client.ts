// Browser-side voxherd client. Calls go through the Next proxy (/api/voxherd/*),
// which adds the bearer token server-side, so nothing here handles auth or CORS.
import type { CommandResult, VoxSession } from "./types";

const BASE = "/api/voxherd";

/** Live registered sessions (GET /api/sessions returns a {session_id: session} map). */
export async function fetchSessions(): Promise<VoxSession[]> {
  const res = await fetch(`${BASE}/api/sessions`, { cache: "no-store" });
  if (!res.ok) throw new Error(`sessions ${res.status}`);
  const data = (await res.json()) as Record<string, VoxSession> | null;
  return data ? Object.values(data) : [];
}

/**
 * Give a session a human name at the voxherd level (POST /api/sessions/{id}/name), so a spawned
 * worker shows its role (planner, worker-1, ...) everywhere, not just in the cockpit roster.
 * Best-effort: the current bridge build has no such endpoint yet (returns 404), in which case the
 * cockpit's role roster still labels it. Activates once the bridge is rebuilt with window_name.
 */
export async function renameSession(sessionId: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ window_name: name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Dispatch a command to a session (POST /api/command -> tmux send-keys). */
export async function sendCommand(input: {
  project: string;
  message: string;
  session_id?: string;
}): Promise<CommandResult> {
  const res = await fetch(`${BASE}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await res.json().catch(() => ({ error: "bad_response" }))) as CommandResult;
}

/**
 * Submit a held bracketed paste. A MULTI-LINE message sent via sendCommand arrives in the
 * session as a bracketed paste that Claude Code holds (shown as "[Pasted text +N lines]") until
 * a SEPARATE Enter; the bridge's own trailing Enter lands inside the paste bracket and so does
 * not submit it. A lone space sent as its OWN command appends harmlessly and its Enter closes
 * the bracket and submits. (An empty message can't be used: the bridge rejects it with "project
 * and message are required".) Single-line messages submit on their own and need no follow-up.
 */
export async function submitSession(input: {
  project: string;
  session_id?: string;
}): Promise<CommandResult> {
  return sendCommand({ ...input, message: " " });
}
