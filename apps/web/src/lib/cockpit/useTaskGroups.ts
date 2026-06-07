"use client";

// Per-task group source for the cockpit overlays. The list of scoring groups a
// task has (the tokenizer's 7 input categories, the textkit's 4 test modules) plus
// the group noun ("category" / "module") is STATIC per task, so we fetch it keyed
// directly on the active task from GET /api/skill?task= (the same mirror the Skill
// Viewer reads), rather than riding on the live skill hydrate (which races with a
// run or a remount). The PLANNER SKILL strip and the Legend both consume this so
// they always render the active task's groups; live coverage still streams in via
// the SSE event stream and the controller's skill state.

import { useEffect, useState } from "react";

import type { TaskName } from "./tasks";

export type TaskGroups = { order: string[]; unit: string };

// Module-level cache so switching back to a task is instant (no refetch flash).
const cache = new Map<TaskName, TaskGroups>();

const EMPTY: TaskGroups = { order: [], unit: "category" };

export function useTaskGroups(task: TaskName): TaskGroups {
  // Holds the result of an in-effect fetch, tagged by task to ignore stale ones
  // and to trigger a re-render once a freshly fetched task is available.
  const [fetched, setFetched] = useState<{
    task: TaskName;
    groups: TaskGroups;
  } | null>(null);

  useEffect(() => {
    if (cache.has(task)) return; // already cached; render reads it directly
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/skill?task=${encodeURIComponent(task)}`, {
          cache: "no-store",
        });
        const d = (await res.json()) as { order?: string[]; unit?: string };
        if (cancelled) return;
        const order = Array.isArray(d?.order) ? d.order.map(String) : [];
        const unit = typeof d?.unit === "string" && d.unit ? d.unit : "category";
        const next: TaskGroups = { order, unit };
        if (order.length) cache.set(task, next);
        // Async (post-await) setState is fine in an effect; it is not the
        // synchronous, cascading-render kind the lint rule guards against.
        setFetched({ task, groups: next });
      } catch {
        // Keep the current value; the live skill state still drives coverage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task]);

  // Render-time read: a cached task is instant; otherwise use a matching fetch
  // result if one has landed; else empty until the fetch resolves.
  return cache.get(task) ?? (fetched?.task === task ? fetched.groups : EMPTY);
}
