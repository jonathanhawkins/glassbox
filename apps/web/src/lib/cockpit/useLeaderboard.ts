"use client";

// Shared leaderboard poller for the cockpit panel and the in-chat charts.
//
// Polls GET /api/leaderboard?task= every 1.5s and returns the per-task rows. Accuracy
// and ordering are authoritative (the planner_scores sorted set); the optional fields
// (added_category, wall_ms, weave_eval_url, status) come from the per-version metadata
// hash, so a reload still shows the ranked, Weave-linked rows of a pre-baked climb.

import { useEffect, useState } from "react";

import { useActiveTask } from "@/lib/cockpit/ActiveTaskContext";
import type { TaskName } from "@/lib/cockpit/tasks";

export type LeaderboardRow = {
  version: number;
  accuracy: number;
  added_category?: string | null;
  wall_ms?: number;
  weave_eval_url?: string | null;
  status?: string;
  gap_source?: string;
  // Per-category signal for the climb matrix: `covered` is the categories scored at
  // this version; `by_group` is the real pass tally per category (live runs).
  covered?: string[];
  by_group?: Record<string, { passed?: number; total?: number }>;
};

/**
 * Poll the active task's leaderboard. `live` keeps polling for the duration of an
 * active climb; pass `taskOverride` when the caller has the task as a prop (the panel,
 * the curve) rather than from context (the chat tools the cockpit cannot prop-drill into).
 */
export function useLeaderboard(live = true, taskOverride?: TaskName) {
  const contextTask = useActiveTask();
  const activeTask = taskOverride ?? contextTask;
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Reset during render when the task switches (the React-recommended pattern), so the
  // chart shows the new task's loading state instead of the old rows while the first
  // poll is in flight, without a clearing setState inside the effect.
  const [rowsTask, setRowsTask] = useState<TaskName>(activeTask);
  if (rowsTask !== activeTask) {
    setRowsTask(activeTask);
    setRows([]);
    setLoaded(false);
  }

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/leaderboard?task=${encodeURIComponent(activeTask)}`,
          { cache: "no-store" },
        );
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
  }, [live, activeTask]);

  return { rows, loaded };
}
