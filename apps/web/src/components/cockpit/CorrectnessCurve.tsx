"use client";

// The money shot: the correctness curve. Polls GET /api/leaderboard every 1.5s
// and plots accuracy (0..1) against planner version, climbing left to right as
// the improver closes capability gaps. recharts AreaChart with a neon stroke.

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

export function CorrectnessCurve() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await res.json()) as LeaderboardRow[];
        if (alive && Array.isArray(data)) setRows(data);
      } catch {
        // keep last good value
      }
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const data = useMemo(
    () =>
      rows.map((r) => ({
        version: r.version,
        accuracy: Math.max(0, Math.min(1, r.accuracy)),
      })),
    [rows],
  );

  const latest = data.length ? data[data.length - 1].accuracy : null;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
          correctness curve
        </span>
        <span className="text-[11px] tabular-nums text-slate-500">
          {data.length ? `v1 to v${data[data.length - 1].version}` : "no runs yet"}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            waiting for the first graded run
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="gb-curve" x1="0" y1="0" x2="0" y2="1">
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
                ticks={[0, 0.25, 0.5, 0.75, 1]}
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
                fill="url(#gb-curve)"
                dot={{ r: 2.5, fill: "#22d3ee", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "#67e8f9" }}
                isAnimationActive
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {latest !== null && (
        <div className="mt-1 text-right text-[11px] tabular-nums text-cyan-300">
          latest {(latest * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
