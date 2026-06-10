// Surface the REAL agent-to-agent coordination from the mcp-agent-mail server (the channel the
// spawned voxherd swarm actually uses) so the cockpit can show who assigned what to whom. The
// mcp-agent-mail HTTP transport (default 127.0.0.1:8765) answers a plain stateless JSON-RPC
// tools/call, so this route is a thin proxy: search_messages -> a chronological feed.
//
// This is the Agent Mail half of "show both Agent Mail and the Claude task list" on the board.
// The Claude task half is the existing /api/voxherd/api/tasks/{project} bead poll.

import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAIL_URL = process.env.AGENT_MAIL_URL || "http://127.0.0.1:8765/api/";
// The agent-mail project key the swarm registered under is the REPO ROOT, not apps/web. Next runs
// from apps/web, so the repo root is two levels up. Override with AGENT_MAIL_PROJECT_KEY.
const DEFAULT_KEY = process.env.AGENT_MAIL_PROJECT_KEY || path.resolve(process.cwd(), "..", "..");

// Broad OR query: search_messages is FTS5, so this catches essentially all coordination traffic
// (assignments, done/verify, leases, status). We re-sort by timestamp for a real feed.
const FEED_QUERY =
  "perf OR scope OR done OR build OR worker OR verify OR task OR plan OR lease OR status OR audit OR fix OR page OR conductor OR validator OR improver OR assigned OR coordinate";

export interface MailItem {
  id: number;
  from: string;
  subject: string;
  importance: string;
  ts: string;
}

/** GET /api/agentmail?key=<project_key>&limit=50 -> { messages: MailItem[] } newest first. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || DEFAULT_KEY;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 60, 200);

  const rpc = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "search_messages",
      arguments: { project_key: key, query: FEED_QUERY, limit },
    },
  };

  try {
    const res = await fetch(MAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(rpc),
      cache: "no-store",
    });
    if (!res.ok) return Response.json({ messages: [], error: `agent-mail ${res.status}` });
    // The tool result is JSON-encoded text inside the JSON-RPC envelope.
    const env = (await res.json()) as { result?: { content?: { text?: string }[] }; error?: unknown };
    const text = env.result?.content?.[0]?.text;
    if (!text) return Response.json({ messages: [], key });
    const inner = JSON.parse(text) as { result?: Record<string, unknown>[] };
    const raw = inner.result ?? [];
    const messages: MailItem[] = raw
      .map((m) => ({
        id: Number(m.id),
        from: String(m.from ?? "?"),
        subject: String(m.subject ?? ""),
        importance: String(m.importance ?? "normal"),
        ts: String(m.created_ts ?? ""),
      }))
      .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return Response.json({ messages, key });
  } catch (e) {
    // Never break the cockpit: an empty feed renders fine.
    return Response.json({ messages: [], key, error: e instanceof Error ? e.message : "mail_error" });
  }
}
