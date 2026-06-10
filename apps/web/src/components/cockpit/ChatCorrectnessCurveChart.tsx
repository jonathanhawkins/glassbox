"use client";

// recharts-only child of ChatCorrectnessCurve (the in-thread chat variant). Holds
// the ResponsiveContainer/AreaChart JSX so recharts (~130KB gzipped) loads lazily
// via next/dynamic and stays out of the always-mounted cockpit chunk. The parent
// keeps all data fetching and passes the prepared points in. Chart only, no logic.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type CurvePoint = { version: number; accuracy: number };

export default function ChatCorrectnessCurveChart({
  data,
}: {
  data: CurvePoint[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="gb-chat-curve" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff6a1a" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#ff6a1a" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis
          dataKey="version"
          tick={{ fill: "#a1a1a6", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "rgba(255,255,255,0.14)" }}
          tickFormatter={(v) => `v${v}`}
        />
        <YAxis
          domain={[0, 1]}
          ticks={[0, 0.5, 1]}
          tick={{ fill: "#a1a1a6", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${Math.round(v * 100)}`}
        />
        <Tooltip
          contentStyle={{
            background: "rgba(11,11,12,0.96)",
            border: "1px solid rgba(255,106,26,0.4)",
            borderRadius: 10,
            fontSize: 12,
            color: "#f5f5f4",
          }}
          labelFormatter={(v) => `planner v${v}`}
          formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "accuracy"]}
        />
        <Area
          type="monotone"
          dataKey="accuracy"
          stroke="#ff6a1a"
          strokeWidth={2.5}
          fill="url(#gb-chat-curve)"
          dot={{ r: 2.5, fill: "#ff6a1a", strokeWidth: 0 }}
          activeDot={{ r: 4, fill: "#ff8a3d" }}
          isAnimationActive
          animationDuration={500}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
