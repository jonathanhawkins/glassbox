"use client";

// A compact rolling ticker of the most recent events, newest first. Purely
// informational; the board is the primary read. Driven by the same event list
// the Cockpit already collects.

import type { GlassboxEvent } from "@glassbox/contract";

const TYPE_COLOR: Record<string, string> = {
  run_started: "#22d3ee",
  plan_started: "#a78bfa",
  bead_created: "#38bdf8",
  bead_claimed: "#fbbf24",
  bead_done: "#34d399",
  validation_passed: "#22c55e",
  validation_failed: "#ef4444",
  plan_gap_found: "#e879f9",
  bead_injected: "#e879f9",
  planner_rewrite: "#f472b6",
  run_finished: "#22c55e",
  agent_status: "#64748b",
  log: "#475569",
};

function fmtTime(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function EventsTicker({ events }: { events: GlassboxEvent[] }) {
  const recent = events.slice(0, 7);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
        event feed
      </span>
      {recent.length === 0 ? (
        <span className="text-[11px] text-slate-600">no events yet</span>
      ) : (
        recent.map((ev, i) => (
          <div
            key={`${ev.ts}-${i}`}
            className="flex items-baseline gap-2 text-[11px] leading-tight"
          >
            <span className="tabular-nums text-slate-600">{fmtTime(ev.ts)}</span>
            <span
              className="font-medium"
              style={{ color: TYPE_COLOR[ev.type] ?? "#94a3b8" }}
            >
              {ev.type}
            </span>
            <span className="truncate text-slate-400">
              {ev.agent}
              {ev.bead_id ? ` #${ev.bead_id.split("-").pop()}` : ""}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
