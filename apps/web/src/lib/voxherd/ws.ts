// Live terminal streaming over the voxherd bridge WebSocket. Outgoing messages are
// HMAC-signed to match the bridge (server_state.py: HMAC-SHA256 over
// json.dumps(msg, sort_keys=True, separators=(",",":"), ensure_ascii=False)). This is a
// best-effort enhancement: if it fails, the caller's polled terminal preview remains.

const BRIDGE_WS = process.env.NEXT_PUBLIC_VOXHERD_WS || "ws://localhost:7777/ws/ios";

let cachedToken: string | null | undefined;

async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    const res = await fetch("/api/voxherd/token", { cache: "no-store" });
    const { token } = (await res.json()) as { token: string | null };
    cachedToken = token;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/** Canonical JSON matching Python json.dumps(sort_keys=True, separators=(",",":")). */
function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

async function hmacHex(token: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signed(token: string | null, msg: Record<string, unknown>): Promise<string> {
  if (!token) return JSON.stringify(msg);
  // The bridge verifies an HMAC under the `_sig` field (server_state.verify_message
  // pops "_sig"); sending it as `sig` makes the bridge drop every message silently.
  const sig = await hmacHex(token, canonical(msg));
  return JSON.stringify({ ...msg, _sig: sig });
}

/** Strip ANSI escape sequences so streamed lines render as clean text. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
}

/**
 * Spawn a new agent session in a project via the bridge (`spawn_session`), optionally
 * sending an initial prompt. Resolves when the bridge accepts (`spawn_accepted`) or errors.
 * Used to bring a conductor / worker into the swarm.
 */
export async function spawnSession(opts: {
  project: string;
  dir?: string;
  assistant?: string;
  prompt?: string;
  // Extra environment for the spawned session, intended to share ONE task list across a swarm
  // (CLAUDE_CODE_TASK_LIST_ID = the conductor's session id) so the plan and the workers'
  // completions land in the one list the board polls.
  //
  // NOTE (verified 2026-06-12): the CURRENT VoxHerdBridge build does NOT read this field — a live
  // test showed the spawned planner still wrote to its OWN session-id task list, not the conductor's.
  // The field is harmless (pydantic drops unknowns) and kept ready for a bridge that adds env
  // support; until then, a shared task list needs a bridge update or a board-side completion merge.
  env?: Record<string, string>;
}): Promise<{ ok: boolean; tmuxSession?: string; error?: string }> {
  const token = await getToken();
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      const url = token ? `${BRIDGE_WS}?token=${encodeURIComponent(token)}` : BRIDGE_WS;
      ws = new WebSocket(url);
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : "ws failed" });
      return;
    }
    const finish = (r: { ok: boolean; tmuxSession?: string; error?: string }) => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), 12000);
    ws.onopen = () => {
      const msg: Record<string, unknown> = { type: "spawn_session", project: opts.project };
      if (opts.dir) msg.dir = opts.dir;
      if (opts.assistant) msg.assistant = opts.assistant;
      if (opts.prompt) msg.prompt = opts.prompt;
      if (opts.env) msg.env = opts.env;
      void signed(token, msg).then((m) => {
        try {
          ws.send(m);
        } catch {
          /* ignore */
        }
      });
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(typeof e.data === "string" ? e.data : "") as {
          type?: string;
          tmux_session?: string;
          message?: string;
        };
        if (m.type === "spawn_accepted") {
          clearTimeout(timer);
          finish({ ok: true, tmuxSession: m.tmux_session });
        } else if (m.type === "error" || m.type === "terminal_error") {
          clearTimeout(timer);
          finish({ ok: false, error: m.message ?? "spawn error" });
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish({ ok: false, error: "ws error" });
    };
  });
}

/**
 * Kill a spawned session entirely (the bridge's `kill_session` runs `tmux kill-session` AND
 * deregisters it), used to tear a swarm down once its goal is met. Best-effort: resolves ok on
 * the bridge ack or after a short wait, the session poll confirms removal either way. Snapshot
 * the session's log to Redis (POST /api/swarm/log) BEFORE calling this, the terminal is gone after.
 */
export async function killSession(tmuxTarget: string): Promise<{ ok: boolean; error?: string }> {
  const name = (tmuxTarget || "").split(":")[0];
  if (!name) return { ok: false, error: "no tmux target" };
  const token = await getToken();
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      const url = token ? `${BRIDGE_WS}?token=${encodeURIComponent(token)}` : BRIDGE_WS;
      ws = new WebSocket(url);
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : "ws failed" });
      return;
    }
    const finish = (r: { ok: boolean; error?: string }) => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: true }), 4000); // assume done; the poll confirms
    ws.onopen = () => {
      void signed(token, { type: "kill_session", tmux_session: name }).then((m) => {
        try {
          ws.send(m);
        } catch {
          /* ignore */
        }
      });
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(typeof e.data === "string" ? e.data : "") as { type?: string; message?: string };
        if (m.type === "session_killed" || m.type === "session_removed") {
          clearTimeout(timer);
          finish({ ok: true });
        } else if (m.type === "error") {
          clearTimeout(timer);
          finish({ ok: false, error: m.message ?? "kill error" });
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish({ ok: false, error: "ws error" });
    };
  });
}

/**
 * Subscribe to a session's live terminal. Calls onContent with cleaned lines as they
 * stream. Returns a cleanup function (unsubscribe + close). Never throws.
 */
export async function openTerminalStream(
  sessionId: string,
  onContent: (lines: string[]) => void,
  onStop?: (summary: string) => void,
): Promise<() => void> {
  const token = await getToken();
  let ws: WebSocket;
  try {
    const url = token ? `${BRIDGE_WS}?token=${encodeURIComponent(token)}` : BRIDGE_WS;
    ws = new WebSocket(url);
  } catch {
    return () => {};
  }

  ws.onopen = () => {
    void signed(token, { type: "terminal_subscribe", session_id: sessionId }).then((m) => {
      try {
        ws.send(m);
      } catch {
        /* ignore */
      }
    });
  };
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(typeof e.data === "string" ? e.data : "") as {
        type?: string;
        session_id?: string;
        event?: string;
        summary?: unknown;
        lines?: unknown;
      };
      if (m.type === "terminal_content" && m.session_id === sessionId && Array.isArray(m.lines)) {
        // Pass RAW lines (ANSI escapes intact) so the UI can render Ghostty-matching
        // colors. Consumers that need plain text strip ANSI themselves (e.g. loop.ts).
        onContent(m.lines.map((l) => String(l)));
      } else if (m.type === "agent_event" && m.session_id === sessionId && m.event === "stop") {
        onStop?.(typeof m.summary === "string" ? m.summary : "");
      }
    } catch {
      /* ignore malformed frames */
    }
  };

  return () => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        void signed(token, { type: "terminal_unsubscribe", session_id: sessionId }).then((m) => {
          try {
            ws.send(m);
          } catch {
            /* ignore */
          }
          ws.close();
        });
      } else {
        ws.close();
      }
    } catch {
      /* ignore */
    }
  };
}
