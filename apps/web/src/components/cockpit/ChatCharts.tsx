"use client";

// Generative-UI building blocks rendered INSIDE the CopilotKit chat thread.
//
// These mirror the cockpit's correctness curve and leaderboard but are sized and
// styled to sit in a chat bubble. Each fetches /api/leaderboard once and then
// polls briefly so a climb that is still running animates upward in the chat.

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type LeaderboardRow = { version: number; accuracy: number };

// Shared poller. Refreshes the leaderboard a few times so an in-flight run fills
// in, then settles. `live` keeps polling for the duration of an active climb.
function useLeaderboard(live = true) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await res.json()) as LeaderboardRow[];
        if (alive && Array.isArray(data)) {
          setRows(data);
          setLoaded(true);
        }
      } catch {
        // keep last good value
      }
    };
    void poll();
    if (!live) return () => { alive = false; };
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [live]);

  return { rows, loaded };
}

export function ChatCorrectnessCurve() {
  const { rows, loaded } = useLeaderboard(true);

  const data = useMemo(
    () =>
      rows
        .slice()
        .sort((a, b) => a.version - b.version)
        .map((r) => ({
          version: r.version,
          accuracy: Math.max(0, Math.min(1, r.accuracy)),
        })),
    [rows],
  );

  const latest = data.length ? data[data.length - 1].accuracy : null;
  const first = data.length ? data[0].accuracy : null;

  return (
    <div className="my-1 w-full rounded-xl border border-cyan-500/30 bg-slate-950/80 p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-cyan-300/90">
          correctness curve
        </span>
        <span className="text-[11px] tabular-nums text-slate-500">
          {data.length ? `v1 to v${data[data.length - 1].version}` : "no runs yet"}
        </span>
      </div>
      <div className="h-[160px] w-full">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
            {loaded
              ? "no graded runs yet. launch a run or the climb to fill this in."
              : "loading leaderboard..."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gb-chat-curve" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
              <XAxis
                dataKey="version"
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(148,163,184,0.2)" }}
                tickFormatter={(v) => `v${v}`}
              />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.5, 1]}
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${Math.round(v * 100)}`}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(2,6,23,0.94)",
                  border: "1px solid rgba(34,211,238,0.4)",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "#e2e8f0",
                }}
                labelFormatter={(v) => `planner v${v}`}
                formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "accuracy"]}
              />
              <Area
                type="monotone"
                dataKey="accuracy"
                stroke="#22d3ee"
                strokeWidth={2.5}
                fill="url(#gb-chat-curve)"
                dot={{ r: 2.5, fill: "#22d3ee", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "#67e8f9" }}
                isAnimationActive
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {latest !== null && first !== null && (
        <div className="mt-1 flex items-baseline justify-between text-[11px] tabular-nums">
          <span className="text-slate-500">
            start {(first * 100).toFixed(0)}%
          </span>
          <span className="text-cyan-300">
            latest {(latest * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

export function ChatLeaderboard() {
  const { rows, loaded } = useLeaderboard(true);

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => a.version - b.version),
    [rows],
  );

  return (
    <div className="my-1 w-full rounded-xl border border-slate-700/50 bg-slate-950/80 p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-300">
        leaderboard
      </div>
      {sorted.length === 0 ? (
        <div className="text-xs text-slate-500">
          {loaded ? "no graded runs yet." : "loading leaderboard..."}
        </div>
      ) : (
        <table className="w-full text-left text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
              <th className="pb-1 font-medium">version</th>
              <th className="pb-1 text-right font-medium">accuracy</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.version} className="border-t border-slate-800/70">
                <td className="py-1 text-violet-300">v{r.version}</td>
                <td className="py-1 text-right text-cyan-300">
                  {(Math.max(0, Math.min(1, r.accuracy)) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
