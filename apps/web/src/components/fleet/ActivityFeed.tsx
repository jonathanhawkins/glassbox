"use client";

// The swarm activity log: one chronological, human-readable stream of everything the
// swarm is doing, newest first. It is the temporal companion to the board (which shows
// spatial state): the board says WHO is busy now, this says WHAT happened, in order.
//
// SwarmView normalizes its three live sources into one ActivityEntry list, mirroring
// Factory's Progress Log: the conductor's sub-agent dispatches and completions (from the
// persisted run log), the agent-to-agent mail (who assigned/reported what), and the loop
// lifecycle (round by round, then the stop). Each row clicks through to its bead or agent,
// so the log doubles as navigation. One orange accent for the live beats, muted otherwise.

import { useEffect, useState } from "react";

import { agentColor } from "@/lib/cockpit/types";

/** The display kind: drives the leading glyph and the muted-vs-accent treatment. */
export type ActivityKind = "mail" | "loop" | "agent" | "run";

export type ActivityEntry = {
  /** Stable React key. */
  id: string;
  /** Epoch ms, for sorting and the relative-time stamp. */
  ts: number;
  /** Who acted: an agent lane (planner, worker-1, ...) or a stream label (loop, swarm, skills). */
  actor: string;
  /** The human-readable detail (the mail subject, the bead title + result, the round). */
  text: string;
  kind: ActivityKind;
  /** A live / important beat: rendered in the one orange accent. */
  accent?: boolean;
  /** Click target: a bead id opens the inspector, an agent focuses that lane. */
  beadId?: string;
  agent?: string;
};

const KIND_MARK: Record<ActivityKind, string> = {
  mail: "✉",
  loop: "↻",
  agent: "●",
  run: "▸",
};

const ACCENT = "#ff8a3d"; // accent-bright, the single live hue

/** Compact "12s / 4m / 3h" relative stamp; clamps future timestamps to 0s. */
function ago(now: number, ts: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ActivityFeed({
  entries,
  onSelect,
}: {
  entries: ActivityEntry[];
  onSelect?: (e: ActivityEntry) => void;
}) {
  // A gentle 1s tick keeps the relative stamps fresh without re-rendering the whole view;
  // only this panel repaints. Cleared on unmount.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!entries.length) {
    return (
      <p className="text-[11px] leading-relaxed text-ink-dim">
        nothing yet. When the swarm coordinates (the conductor dispatches sub-agents, workers
        report over agent mail, the loop steps round by round) every beat lands here, newest first.
      </p>
    );
  }

  // Rows stay on one line and the container scrolls on BOTH axes, so a long line (a mail
  // subject, a recorded result) is read by scrolling right instead of being ellipsized. The
  // inner w-max wrapper sizes to the widest row so every row is the same width (hover spans
  // the full line) and min-w-full keeps it filling the panel when the content is short.
  return (
    <div className="min-h-0 flex-1 overflow-auto pr-1 font-mono text-[10px] leading-relaxed">
      <div className="flex w-max min-w-full flex-col gap-0.5">
        {entries.map((e) => {
          const clickable = Boolean(onSelect && (e.beadId || e.agent));
          return (
            <button
              key={e.id}
              type="button"
              disabled={!clickable}
              onClick={() => onSelect?.(e)}
              title={e.text}
              className={`flex w-full items-baseline gap-1.5 whitespace-nowrap rounded px-1 py-0.5 text-left transition ${
                clickable ? "cursor-pointer hover:bg-raised/70" : "cursor-default"
              }`}
            >
              <span className="w-7 shrink-0 tabular-nums text-ink-dim opacity-70">{ago(now, e.ts)}</span>
              <span className="shrink-0" style={{ color: e.accent ? ACCENT : agentColor(e.actor) }}>
                {KIND_MARK[e.kind]}
              </span>
              <span className={`shrink-0 ${e.accent ? "text-accent" : "text-ink-mid"}`}>{e.actor}</span>
              <span className="shrink-0 text-ink-dim">{e.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
