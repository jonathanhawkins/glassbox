"use client";

// The money shot: the correctness curve. Reads from the shared useLeaderboard
// store (one poll per task shared across all consumers) and plots accuracy (0..1)
// against planner version, climbing left to right as the improver closes capability
// gaps. recharts AreaChart with a neon stroke. The active task is threaded in so
// the curve reflects whichever target the operator is running.

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import type { TaskName } from "@/lib/cockpit/tasks";
import { useLeaderboard } from "@/lib/cockpit/useLeaderboard";
import { CollapseButton } from "./CollapseButton";

// Lazy boundary: recharts (~130KB gzipped) lives only in this child, so it loads
// on demand instead of riding in the always-mounted cockpit chunk. ssr:false keeps
// it client-only; the curve has its own empty/waiting states so no loader is needed.
const Chart = dynamic(() => import("./CorrectnessCurveChart"), {
  ssr: false,
  loading: () => null,
});

export function CorrectnessCurve({ activeTask }: { activeTask: TaskName }) {
  // Share the module-level leaderboard store with LeaderboardPanel (both are
  // mounted in the right rail): one poll per task instead of two concurrent polls
  // hitting /api/leaderboard at the same 1.5s cadence. The store's snapshot
  // comparison already suppresses re-renders when rows are unchanged.
  const { rows } = useLeaderboard(true, activeTask);
  const [open, setOpen] = useState(true);

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
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CollapseButton open={open} onClick={() => setOpen((o) => !o)} label="curve" />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mid">
            correctness curve
          </span>
        </div>
        <span className="flex items-baseline gap-2 tabular-nums">
          {latest !== null && (
            <span className="text-[11px] font-medium text-accent">
              {(latest * 100).toFixed(1)}%
            </span>
          )}
          <span className="text-[10px] text-ink-dim">
            {data.length ? `v1 to v${data[data.length - 1].version}` : "no runs yet"}
          </span>
        </span>
      </div>
      <div className={`-mb-1 mt-1 h-[150px] ${open ? "" : "hidden"}`}>
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-dim">
            waiting for the first graded run
          </div>
        ) : (
          <Chart data={data} />
        )}
      </div>
    </div>
  );
}
