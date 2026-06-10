"use client";

// The self-improvement curve for the deck centerpiece slide.
//
// Adapts the cockpit's CorrectnessCurve / ChatCorrectnessCurve (same recharts
// AreaChart, same orange-accent stroke and gradient) but sized large for a
// projector. It fetches GET /api/leaderboard once and then polls so a climb
// that is running live fills upward on screen. If the API is unreachable or
// returns no graded runs, it falls back to the known v1..v7 ground-truth curve
// so the slide always looks right during the pitch.

import { useEffect, useMemo, useState } from "react";

import { pollWhileVisible } from "@/lib/cockpit/pollWhileVisible";
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
    // Last payload we pushed to state. The poll runs every 1.5s, but on a stable
    // climb it returns identical rows; calling setRows with a fresh array each tick
    // would re-render the recharts AreaChart (and re-run its 650ms animation) twice
    // a second on the projector for nothing. Gate state updates on a real change.
    let lastSnap = "";
    const poll = async () => {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await res.json()) as LeaderboardRow[];
        if (alive && Array.isArray(data) && data.length > 0) {
          const snap = JSON.stringify(data);
          if (snap !== lastSnap) {
            lastSnap = snap;
            setRows(data);
          }
          setLive(true); // no-op once already live (same value bails out)
        }
      } catch {
        // Unreachable: keep showing the fallback curve.
      }
    };
    void poll();
    // Visibility-aware: a projector deck left on a background tab should not keep
    // polling /api/leaderboard every 1.5s. pollWhileVisible pauses while hidden and
    // refreshes on return.
    const stop = pollWhileVisible(() => void poll(), 1500);
    return () => {
      alive = false;
      stop();
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
        <span className="font-mono text-sm uppercase tracking-[0.2em] text-ink-dim">
          correctness curve
        </span>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 font-mono text-xs ${
            live
              ? "border-pass/40 bg-pass/10 text-pass"
              : "border-line bg-white/[0.04] text-ink-dim"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? "bg-pass" : "bg-ink-dim"}`}
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
                <stop offset="0%" stopColor="#ff6a1a" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#ff6a1a" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              dataKey="version"
              tick={{ fill: "#a1a1a6", fontSize: 14 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.14)" }}
              tickFormatter={(v) => `v${v}`}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tick={{ fill: "#a1a1a6", fontSize: 14 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${Math.round(v * 100)}`}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(11,11,12,0.96)",
                border: "1px solid rgba(255,106,26,0.4)",
                borderRadius: 8,
                fontSize: 14,
                color: "#f5f5f4",
              }}
              labelFormatter={(v) => `planner v${v}`}
              formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "accuracy"]}
            />
            <Area
              type="monotone"
              dataKey="accuracy"
              stroke="#ff6a1a"
              strokeWidth={3}
              fill="url(#gb-deck-curve)"
              dot={{ r: 4, fill: "#ff6a1a", strokeWidth: 0 }}
              activeDot={{ r: 6, fill: "#ff8a3d" }}
              isAnimationActive
              animationDuration={650}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3 font-mono text-sm tabular-nums">
        <span className="text-ink-dim">
          v1 {(first * 100).toFixed(0)}%
        </span>
        <span className="text-ink-dim">each version, plus one category</span>
        <span className="text-accent">
          v{lastVersion} {(latest * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
