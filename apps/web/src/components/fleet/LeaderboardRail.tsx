"use client";

// The oracle's scoreboard, on the cockpit: per-version rows from the tokenizer leaderboard
// (Redis sorted set + meta hash via /api/leaderboard) with each version's wall_ms, accuracy,
// and the deep link to ITS real Weave Evaluation. This is the judging surface: the swarm's
// climb is graded by the harness, every grade is a logged weave.Evaluation, and the cockpit
// links straight to it. Renders nothing until a score exists, so non-graded runs lose no rail
// space. Polls only while mounted (the rail is open).

import { useEffect, useState } from "react";

import { CollapseButton } from "@/components/cockpit/CollapseButton";
import { usePersistentState } from "@/lib/usePersistentState";

interface Row {
  version: number;
  accuracy: number;
  wall_ms?: number;
  weave_eval_url?: string | null;
}

const POLL_MS = 5000;
const MAX_ROWS = 6;

export function LeaderboardRail({ task = "tokenizer" }: { task?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = usePersistentState("glassbox-swarm-leaderboard-open-v1", true);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch(`/api/leaderboard?task=${encodeURIComponent(task)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data: Row[]) => {
          if (alive && Array.isArray(data)) setRows(data);
        })
        .catch(() => {});
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [task]);

  if (!rows.length) return null;

  // Newest versions first; flag the best wall_ms (the climb's current summit).
  const sorted = [...rows].sort((a, b) => b.version - a.version).slice(0, MAX_ROWS);
  const walls = rows.map((r) => r.wall_ms).filter((x): x is number => typeof x === "number");
  const bestWall = walls.length ? Math.min(...walls) : null;

  return (
    <div className="mt-4 shrink-0 border-t border-line pt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CollapseButton open={open} onClick={() => setOpen((o) => !o)} label="leaderboard" />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-dim">
            leaderboard
          </span>
        </div>
        <span className="font-mono text-[10px] text-ink-dim">{task}</span>
      </div>
      {open && (
        <div className="flex flex-col gap-1">
          {sorted.map((r) => {
            const isBest = r.wall_ms != null && r.wall_ms === bestWall;
            return (
              <div
                key={r.version}
                className="flex items-center gap-2 font-mono text-[11px] text-ink-dim"
              >
                <span className={isBest ? "text-accent" : "text-ink-mid"}>v{r.version}</span>
                <span className={isBest ? "font-semibold text-ink" : ""}>
                  {r.wall_ms != null ? `${r.wall_ms} ms` : "—"}
                </span>
                <span>acc {r.accuracy.toFixed(3)}</span>
                {isBest && <span className="text-accent">best</span>}
                {r.weave_eval_url && (
                  <a
                    href={r.weave_eval_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-ink-dim underline decoration-line underline-offset-2 transition hover:text-accent"
                    title="open this version's Weave Evaluation"
                  >
                    weave ↗
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
