"use client";

// A compact rolling ticker of the most recent events, newest first. Purely
// informational; the board is the primary read. Driven by the same event list
// the Cockpit already collects.

import { memo } from "react";

import type { GlassboxEvent } from "@glassbox/contract";
import { CollapseButton } from "./CollapseButton";

// Event type accents: orange family for the live/active beats (run + work
// handoffs + the self-improvement rewrite/gap/inject), muted green/red for the
// oracle verdicts, neutral grays for routine bookkeeping.
const TYPE_COLOR: Record<string, string> = {
  run_started: "#ff6a1a", // accent
  plan_started: "#a1a1a6", // ink-mid
  bead_created: "#9aa0a6", // neutral
  bead_claimed: "#ff6a1a", // accent (active)
  bead_done: "#9aa0a6", // neutral (settled)
  validation_passed: "#5ba372", // pass
  validation_failed: "#d85a52", // fail
  plan_gap_found: "#ff8a3d", // accent-bright (attention)
  bead_injected: "#ff8a3d", // accent-bright (hot / new)
  planner_rewrite: "#ff6a1a", // accent (the climb)
  run_finished: "#5ba372", // pass
  agent_status: "#6e6e73", // ink-dim
  log: "#46464b", // ink-faint
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

function EventsTickerImpl({
  events,
  open,
  onToggle,
}: {
  events: GlassboxEvent[];
  open: boolean;
  onToggle: () => void;
}) {
  // The rail now gives this panel real height, so show more history and let it
  // scroll instead of hard-capping at a handful of rows.
  const recent = events.slice(0, 40);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex shrink-0 items-center gap-2">
        <CollapseButton open={open} onClick={onToggle} label="event feed" />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-dim">
          event feed
        </span>
      </div>
      {!open ? null : recent.length === 0 ? (
        <span className="text-[11px] text-ink-dim">no events yet</span>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
          {recent.map((ev) => (
            <div
              key={`${ev.run_id}-${ev.ts}-${ev.type}-${ev.bead_id}`}
              className="flex items-baseline gap-2 font-mono text-[11px] leading-tight"
            >
              <span className="tabular-nums text-ink-faint">{fmtTime(ev.ts)}</span>
              <span
                className="font-medium"
                style={{ color: TYPE_COLOR[ev.type] ?? "#a1a1a6" }}
              >
                {ev.type}
              </span>
              <span className="truncate text-ink-dim">
                {ev.agent}
                {ev.bead_id ? ` #${ev.bead_id.split("-").pop()}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Memoized: the cockpit re-renders on every incoming event, but this ticker only
// needs to repaint when its own props (events list / open state) actually change.
export const EventsTicker = memo(EventsTickerImpl);
