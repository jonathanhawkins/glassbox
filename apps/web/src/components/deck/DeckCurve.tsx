"use client";

// The self-improvement curve for the deck centerpiece slide.
//
// Adapts the cockpit's CorrectnessCurve / ChatCorrectnessCurve (same recharts
// AreaChart, same neon-cyan stroke and gradient) but sized large for a
// projector. It fetches GET /api/leaderboard once and then polls so a climb
// that is running live fills upward on screen. If the API is unreachable or
// returns no graded runs, it falls back to the known v1..v7 ground-truth curve
// so the slide always looks right during the pitch.

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

// Each planner version adds exactly one of the 7 input categories, so the
// honest curve steps +1/7 per version. This is the known v1..v7 climb used as
// the fallback when no live run has populated the leaderboard yet.
const FALLBACK: LeaderboardRow[] = [
  { version: 1, accuracy: 0.143 },
  { version: 2, accuracy: 0.286 },
  { version: 3, accuracy: 0.429 },
  { version: 4, accuracy: 0.571 },
  { version: 5, accuracy: 0.714 },
  { version: 6, accuracy: 0.857 },
  { version: 7, accuracy: 1.0 },
];

export function DeckCurve() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  // True once we have rows from the API; until then we render the fallback so
  // the slide is never blank, but we do not falsely claim the source is "live".
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await res.json()) as LeaderboardRow[];
        if (alive && Array.isArray(data) && data.length > 0) {
          setRows(data);
          setLive(true);
        }
      } catch {
        // Unreachable: keep showing the fallback curve.
      }
    };
    void poll();
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const data = useMemo(() => {
    const source = rows.length > 0 ? rows : FALLBACK;
    return source
      .slice()
      .sort((a, b) => a.version - b.version)
      .map((r) => ({
        version: r.version,
        accuracy: Math.max(0, Math.min(1, r.accuracy)),
      }));
  }, [rows]);

  const first = data[0]?.accuracy ?? 0;
  const latest = data[data.length - 1]?.accuracy ?? 0;
  const lastVersion = data[data.length - 1]?.version ?? 0;

  return (
    <div className="flex w-full flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-sm uppercase tracking-[0.2em] text-slate-400">
          correctness curve
        </span>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 font-mono text-xs ${
            live
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-slate-600/50 bg-slate-800/40 text-slate-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-slate-500"}`}
          />
          {live ? "live (Redis)" : "v1 to v7"}
        </span>
      </div>

      {/* A fixed pixel height (not a percentage / flex-1 chain) so recharts'
          ResponsiveContainer always measures a positive box on its first mount
          frame. A percentage height resolves to -1 for one tick when this slide
          mounts (it is rendered only while active), which triggers recharts'
          width/height(-1) warning. This matches the proven cockpit curve, which
          lives in a fixed-height container and never warns. */}
      <div className="h-[20rem] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -8 }}>
            <defs>
              <linearGradient id="gb-deck-curve" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
            <XAxis
              dataKey="version"
              tick={{ fill: "#94a3b8", fontSize: 14 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(148,163,184,0.2)" }}
              tickFormatter={(v) => `v${v}`}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tick={{ fill: "#94a3b8", fontSize: 14 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${Math.round(v * 100)}`}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(2,6,23,0.94)",
                border: "1px solid rgba(34,211,238,0.4)",
                borderRadius: 10,
                fontSize: 14,
                color: "#e2e8f0",
              }}
              labelFormatter={(v) => `planner v${v}`}
              formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "accuracy"]}
            />
            <Area
              type="monotone"
              dataKey="accuracy"
              stroke="#22d3ee"
              strokeWidth={3}
              fill="url(#gb-deck-curve)"
              dot={{ r: 4, fill: "#22d3ee", strokeWidth: 0 }}
              activeDot={{ r: 6, fill: "#67e8f9" }}
              isAnimationActive
              animationDuration={650}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-baseline justify-between border-t border-slate-800/70 pt-3 font-mono text-sm tabular-nums">
        <span className="text-slate-500">
          v1 {(first * 100).toFixed(0)}%
        </span>
        <span className="text-slate-500">each version, plus one category</span>
        <span className="text-cyan-300">
          v{lastVersion} {(latest * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
