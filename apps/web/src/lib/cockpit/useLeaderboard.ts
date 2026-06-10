"use client";

// Shared leaderboard poller for the cockpit panel and the in-chat charts.
//
// Polls GET /api/leaderboard?task= every 1.5s and returns the per-task rows. Accuracy
// and ordering are authoritative (the planner_scores sorted set); the optional fields
// (added_category, wall_ms, weave_eval_url, status) come from the per-version metadata
// hash, so a reload still shows the ranked, Weave-linked rows of a pre-baked climb.
//
// To avoid 4-5 consumers each mounting their own setInterval, the polling is hoisted to
// a module-level store keyed by task: one entry per distinct task id holding its cached
// rows and the set of subscriber callbacks, ref-counted on mount/unmount. A single
// shared pollTimer fetches every task that currently has at least one subscriber, and is
// cleared when the last subscriber unmounts. This mirrors the store + subs + single
// pollTimer pattern in useTasks.ts.

import { useEffect, useState } from "react";

import { useActiveTask } from "@/lib/cockpit/ActiveTaskContext";
import { pollWhileVisible } from "@/lib/cockpit/pollWhileVisible";
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

type TaskEntry = {
  rows: LeaderboardRow[];
  loaded: boolean;
  // Serialized last payload, so a poll that returns identical rows triggers zero
  // re-renders. The leaderboard charts are recharts (expensive to re-render); during
  // a stable climb the 1.5s poll returns the same rows, and firing every subscriber
  // on each tick would re-render those charts twice a second for nothing.
  snapshot: string;
  subs: Set<() => void>;
};

// One entry per distinct task id. Created lazily when the first consumer subscribes,
// removed when its last consumer unsubscribes.
const store = new Map<TaskName, TaskEntry>();

function entryFor(task: TaskName): TaskEntry {
  let entry = store.get(task);
  if (!entry) {
    entry = { rows: [], loaded: false, snapshot: "", subs: new Set() };
    store.set(task, entry);
  }
  return entry;
}

async function pollTask(task: TaskName): Promise<void> {
  try {
    const res = await fetch(
      `/api/leaderboard?task=${encodeURIComponent(task)}`,
      { cache: "no-store" },
    );
    const data = (await res.json()) as LeaderboardRow[];
    const entry = store.get(task);
    // The task may have lost all subscribers (and been dropped) while the fetch was
    // in flight; only publish if it is still live.
    if (entry && Array.isArray(data)) {
      const nextSnapshot = JSON.stringify(data);
      const wasLoaded = entry.loaded;
      entry.rows = data;
      entry.loaded = true;
      // Notify only when the payload actually changed (or on the first successful
      // load, so consumers clear their loading state). An unchanged tick is a no-op,
      // so the recharts curve does not re-render on every steady poll. Mirrors the
      // change-gated emit in useSessions.ts.
      if (nextSnapshot !== entry.snapshot || !wasLoaded) {
        entry.snapshot = nextSnapshot;
        for (const fn of entry.subs) fn();
      }
    }
  } catch {
    // keep last good value
  }
}

// The shared poll is visibility-aware: it pauses while the tab is hidden (a
// backgrounded cockpit/chart should not keep hitting /api/leaderboard every 1.5s)
// and catches up immediately when the operator returns. stopPoll is the cleanup
// returned by pollWhileVisible; null means no timer is currently armed.
let stopPoll: (() => void) | null = null;

function pollAll() {
  for (const task of store.keys()) void pollTask(task);
}

function ensurePolling() {
  if (stopPoll) return;
  stopPoll = pollWhileVisible(pollAll, 1500);
}

function stopPollingIfIdle() {
  if (!stopPoll) return;
  for (const entry of store.values()) {
    if (entry.subs.size > 0) return;
  }
  stopPoll();
  stopPoll = null;
}

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
    const entry = entryFor(activeTask);
    // Publish this consumer's view from the shared cache whenever the entry updates.
    const sync = () => {
      setRows(entry.rows);
      setLoaded(entry.loaded);
    };
    entry.subs.add(sync);
    // Seed from any cache a sibling consumer already populated, then fetch fresh.
    if (entry.loaded) sync();
    void pollTask(activeTask);

    if (!live) {
      // A non-live consumer wants a single snapshot, not a recurring poll. Still
      // subscribe so it reflects a live sibling's updates, but do not start the timer.
      return () => {
        entry.subs.delete(sync);
        if (entry.subs.size === 0) store.delete(activeTask);
        stopPollingIfIdle();
      };
    }

    ensurePolling();
    return () => {
      entry.subs.delete(sync);
      if (entry.subs.size === 0) store.delete(activeTask);
      stopPollingIfIdle();
    };
  }, [live, activeTask]);

  return { rows, loaded };
}
