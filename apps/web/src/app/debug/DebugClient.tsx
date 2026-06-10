"use client";

import { useCallback, useEffect, useState } from "react";
import type { GlassboxEvent } from "@glassbox/contract";

type LeaderboardRow = { version: number; accuracy: number };

const MAX_EVENTS = 200;

function fmtTime(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

/**
 * Phase 2 transport proof. This page exercises every seam route end to end:
 *  - EventSource("/api/events") -> live SSE feed of the swarm.
 *  - poll /api/leaderboard every 2s -> the climb curve as a table.
 *  - POST /api/run and /api/loop -> kick the backend through the proxies.
 *
 * The fancy tldraw cockpit (Phase 3) consumes the exact same two endpoints.
 */
export function DebugClient() {
  const [events, setEvents] = useState<GlassboxEvent[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [sseStatus, setSseStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [lastAction, setLastAction] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // Total events seen since mount (events list is capped, so we count separately).
  const [eventCount, setEventCount] = useState(0);

  // --- live event stream -------------------------------------------------
  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onopen = () => setSseStatus("open");
    es.onmessage = (e) => {
      let parsed: GlassboxEvent | null = null;
      try {
        parsed = JSON.parse(e.data) as GlassboxEvent;
      } catch {
        return;
      }
      setEventCount((c) => c + 1);
      setEvents((prev) => {
        const next = [parsed as GlassboxEvent, ...prev];
        return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
      });
    };
    es.onerror = () => {
      // EventSource auto-reconnects; reflect the transient state.
      setSseStatus(es.readyState === EventSource.CLOSED ? "closed" : "connecting");
    };

    return () => es.close();
  }, []);

  // --- leaderboard polling ----------------------------------------------
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await res.json()) as LeaderboardRow[];
        if (alive && Array.isArray(data)) setLeaderboard(data);
      } catch {
        // keep last good value
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // --- actions -----------------------------------------------------------
  const post = useCallback(
    async (path: string, body: unknown, label: string) => {
      setBusy(true);
      setLastAction(`${label}...`);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        setLastAction(`${label}: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
      } catch (err) {
        setLastAction(`${label}: failed ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const launchRun = () =>
    post("/api/run", { goal: "port the BPE tokenizer to Rust" }, "Launch run");
  const runClimb = () => post("/api/loop", { versions: 5 }, "Run climb x5");

  const statusColor =
    sseStatus === "open"
      ? "bg-green-500"
      : sseStatus === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <main className="mx-auto max-w-5xl p-6 font-mono text-sm text-zinc-100">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Glassbox transport debug</h1>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <span className="text-zinc-400">
            SSE {sseStatus} ({eventCount} events)
          </span>
        </div>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={launchRun}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Launch run
        </button>
        <button
          onClick={runClimb}
          disabled={busy}
          className="rounded bg-purple-600 px-3 py-1.5 font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          Run climb x5
        </button>
        {lastAction && (
          <span className="max-w-2xl truncate text-zinc-400">{lastAction}</span>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Leaderboard */}
        <section className="md:col-span-1">
          <h2 className="mb-2 font-semibold text-zinc-300">Leaderboard</h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-400">
                <th className="py-1 pr-4">version</th>
                <th className="py-1">accuracy</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-2 text-zinc-500">
                    no scores yet
                  </td>
                </tr>
              ) : (
                leaderboard.map((row) => (
                  <tr key={row.version} className="border-b border-zinc-800">
                    <td className="py-1 pr-4">v{row.version}</td>
                    <td className="py-1">{(row.accuracy * 100).toFixed(1)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {/* Event feed */}
        <section className="md:col-span-2">
          <h2 className="mb-2 font-semibold text-zinc-300">
            Live events (newest first)
          </h2>
          <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
            {events.length === 0 ? (
              <li className="p-3 text-zinc-500">
                waiting for events... (try Launch run, or emit a test event via
                redis-cli)
              </li>
            ) : (
              events.map((ev, i) => (
                <li
                  // Events are prepended, so the array index shifts on every arrival; key on the
                  // event's own (stable) fields instead so already-rendered rows keep their key.
                  // i is the final tiebreaker for the rare same-ms/same-agent/same-bead collision.
                  key={`${ev.ts}-${ev.type}-${ev.agent}-${ev.bead_id ?? ""}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 p-2"
                >
                  <span className="text-zinc-500">{fmtTime(ev.ts)}</span>
                  <span className="font-semibold text-pass">{ev.type}</span>
                  <span className="text-accent">{ev.agent}</span>
                  {ev.bead_id ? (
                    <span className="text-accent-bright">#{ev.bead_id}</span>
                  ) : null}
                  {typeof ev.planner_version === "number" ? (
                    <span className="text-zinc-500">v{ev.planner_version}</span>
                  ) : null}
                  {ev.title ? (
                    <span className="text-zinc-300">{ev.title}</span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <footer className="mt-6 text-zinc-500">
        Routes: /api/events (SSE), /api/leaderboard, /api/beads, /api/run,
        /api/loop. Phase 3 board consumes the same /api/events + /api/leaderboard.
      </footer>
    </main>
  );
}
