"use client";

// Per-task group source for the cockpit overlays. The list of scoring groups a
// task has (the tokenizer's 7 input categories, the textkit's 4 test modules, or a
// BYO repo's discovered failing test modules) plus the group noun ("category" /
// "module" / "test"). The two built-in curated tasks have FIXED, known groups, so
// they are seeded from a static map below: the strip and the Legend show their real
// tiles instantly, and a transient GET /api/skill blip (a backend restart, a reset
// race) can never collapse them into the "discovering" skeleton. A BYO task has no
// seed: the backend is still DISCOVERING its groups (the fetch returns them once the
// first eval lands), so we POLL while the order is empty and light the strip up the
// moment groups appear. The PLANNER SKILL strip and the Legend both consume this.

import { useEffect, useState } from "react";

import type { TaskName } from "./tasks";

export type TaskGroups = { order: string[]; unit: string };

// The built-in curated tasks: their group set is fixed (mirrors the backend's static
// cfg.order), so seed it on the frontend rather than depending on a live fetch. BYO
// tasks are absent here and fall through to the discovering poll below.
const CURATED_GROUPS: Record<string, TaskGroups> = {
  tokenizer: {
    order: ["ascii", "punctuation", "numbers", "code", "unicode", "whitespace", "emoji"],
    unit: "category",
  },
  textkit: {
    order: ["slug", "wrap", "numbers", "template"],
    unit: "module",
  },
};

// Module-level cache so switching back to a task is instant (no refetch flash).
const cache = new Map<TaskName, TaskGroups>();

const EMPTY: TaskGroups = { order: [], unit: "category" };

// How long to keep polling for a discovering (BYO) task before giving up (~60s).
const MAX_POLLS = 40;

export function useTaskGroups(task: TaskName): TaskGroups {
  // Curated tasks have a fixed, known group set: return it directly so the strip and
  // the Legend never fall into the BYO "discovering" state on a transient backend blip.
  const curated = CURATED_GROUPS[task];
  const [fetched, setFetched] = useState<{ task: TaskName; groups: TaskGroups } | null>(
    null,
  );

  useEffect(() => {
    if (CURATED_GROUPS[task]) return; // curated groups are static; no fetch or poll needed
    if (cache.has(task)) return; // already cached; render reads it directly
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/skill?task=${encodeURIComponent(task)}`, {
          cache: "no-store",
        });
        const d = (await res.json()) as { order?: string[]; unit?: string };
        if (cancelled) return;
        const order = Array.isArray(d?.order) ? d.order.map(String) : [];
        const unit = typeof d?.unit === "string" && d.unit ? d.unit : "category";
        const next: TaskGroups = { order, unit };
        if (order.length) {
          cache.set(task, next);
          setFetched({ task, groups: next });
          return; // done: groups landed
        }
        setFetched({ task, groups: next });
      } catch {
        // keep polling; the live skill state still drives coverage
      }
      // No groups yet (BYO still discovering): poll a bounded number of times so a
      // discovering BYO task lights up without a reload.
      if (!cancelled && polls < MAX_POLLS) {
        polls += 1;
        timer = setTimeout(tick, 1500);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [task]);

  if (curated) return curated; // tokenizer/textkit: always their known tiles
  return cache.get(task) ?? (fetched?.task === task ? fetched.groups : EMPTY);
}
