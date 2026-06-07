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

import { TASK_GOALS, type TaskMeta } from "./tasks";

const CURATED_FALLBACK: TaskMeta[] = [
  { id: "tokenizer", label: "tokenizer", goal: TASK_GOALS.tokenizer, unit: "category", kind: "curated" },
  { id: "textkit", label: "textkit", goal: TASK_GOALS.textkit, unit: "module", kind: "curated" },
];

let store: TaskMeta[] = CURATED_FALLBACK;
let loaded = false;
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
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
    store = normalize(await res.json());
    loaded = true;
    emit();
  } catch {
    loaded = true; // keep the fallback / last list
    emit();
  }
}

/** Optimistically add a just-created task (e.g. a BYO task) so the switcher shows
 * it immediately, before the next /api/tasks poll confirms it. */
export function addTaskOptimistic(meta: TaskMeta): void {
  if (!store.some((t) => t.id === meta.id)) {
    store = [...store, meta];
    emit();
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (store.some((t) => t.discovering)) void refreshTasks();
  }, 1500);
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
    };
  }, []);

  return { tasks: store, loaded };
}
