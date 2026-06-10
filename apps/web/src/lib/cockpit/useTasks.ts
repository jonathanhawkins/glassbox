"use client";

// The dynamic task list for the cockpit. The swarm's available tasks are no
// longer a hardcoded pair: GET /api/tasks lists the built-in curated tasks plus
// any bring-your-own-repo tasks created at runtime. The TASK switcher renders
// from this. A module-level store (cache + subscribers) keeps every mounted
// consumer in sync, falls back to the two built-in curated tasks if the backend
// is unreachable (so the switcher is NEVER empty on stage), and polls while any
// task is still "discovering" its groups (a fresh BYO run) so the new task and
// its post-discovery metadata land without a reload.

import { useEffect, useState } from "react";

import { pollWhileVisible } from "./pollWhileVisible";
import { TASK_GOALS, type TaskMeta } from "./tasks";

const CURATED_FALLBACK: TaskMeta[] = [
  { id: "tokenizer", label: "tokenizer", goal: TASK_GOALS.tokenizer, unit: "category", kind: "curated" },
  { id: "textkit", label: "textkit", goal: TASK_GOALS.textkit, unit: "module", kind: "curated" },
];

let store: TaskMeta[] = CURATED_FALLBACK;
let loaded = false;
// Serialized last list so a poll returning the same tasks fires no re-renders. The
// poll runs every 1.5s while a BYO task is still "discovering", and the switcher and
// its consumers should only re-render when the task list actually changes.
let snapshot = "";
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
}

/** Publish a new task list, notifying subscribers only when it actually changed
 * (or on the first load, so consumers leave their unloaded state). */
function publish(next: TaskMeta[]): void {
  const nextSnapshot = JSON.stringify(next);
  const wasLoaded = loaded;
  store = next;
  loaded = true;
  if (nextSnapshot !== snapshot || !wasLoaded) {
    snapshot = nextSnapshot;
    emit();
  }
}

function normalize(raw: unknown): TaskMeta[] {
  if (!Array.isArray(raw)) return CURATED_FALLBACK;
  const out: TaskMeta[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      label: typeof r.label === "string" ? r.label : r.id,
      goal: typeof r.goal === "string" ? r.goal : (TASK_GOALS[r.id] ?? ""),
      unit: typeof r.unit === "string" ? r.unit : undefined,
      kind: r.kind === "byo" ? "byo" : "curated",
      repo: typeof r.repo === "string" ? r.repo : undefined,
      test_command: typeof r.test_command === "string" ? r.test_command : undefined,
      editable: typeof r.editable === "string" ? r.editable : undefined,
      discovering: r.discovering === true,
    });
  }
  return out.length ? out : CURATED_FALLBACK;
}

export async function refreshTasks(): Promise<void> {
  try {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    publish(normalize(await res.json()));
  } catch {
    // keep the fallback / last list; publish() still flips `loaded` on first run
    publish(store);
  }
}

/** Optimistically add a just-created task (e.g. a BYO task) so the switcher shows
 * it immediately, before the next /api/tasks poll confirms it. */
export function addTaskOptimistic(meta: TaskMeta): void {
  if (!store.some((t) => t.id === meta.id)) {
    store = [...store, meta];
    // Keep the change-gate snapshot in sync so the next confirming poll, which
    // returns this same task, does not fire a redundant re-render.
    snapshot = JSON.stringify(store);
    emit();
  }
}

// Visibility-aware: the discovering poll pauses while the tab is hidden and
// catches up on return (pollWhileVisible). stopPoll is its cleanup; null when no
// timer is armed.
let stopPoll: (() => void) | null = null;

function ensurePolling() {
  if (stopPoll) return;
  stopPoll = pollWhileVisible(() => {
    if (store.some((t) => t.discovering)) void refreshTasks();
  }, 1500);
}

function stopPolling() {
  if (stopPoll) {
    stopPoll();
    stopPoll = null;
  }
}

export type UseTasks = { tasks: TaskMeta[]; loaded: boolean };

export function useTasks(): UseTasks {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    subs.add(rerender);
    ensurePolling();
    if (!loaded) void refreshTasks();
    return () => {
      subs.delete(rerender);
      // The 1.5s poll is module-level and would otherwise run for the tab's whole
      // life. Stop it once no consumer is mounted; ensurePolling() re-arms it when
      // a new subscriber appears.
      if (subs.size === 0) stopPolling();
    };
  }, []);

  return { tasks: store, loaded };
}
