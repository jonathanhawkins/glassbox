"use client";

// Launch controls (the always-available fallback to the chat command bar).
// POST /api/run kicks one graded run; POST /api/loop runs the genuine
// self-improvement climb (the headline demo); POST /api/live runs the
// spot-a-gap inject beat. A small goal input retargets the swarm without code.
//
// The TASK switcher picks which target the swarm builds: "tokenizer" (the Rust
// BPE port, graded by an exact oracle) or "textkit" (a Python textkit library,
// graded by pytest). The selected task is owned by the cockpit and threaded into
// every launch body (the /api routes forward it), so a run, climb, live inject,
// or reset all target the active task.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultGoalFor, type TaskName } from "@/lib/cockpit/tasks";
import { useTasks } from "@/lib/cockpit/useTasks";
import { NewTaskDialog } from "./NewTaskDialog";
import { CollapseButton } from "./CollapseButton";

type Kind = "run" | "loop" | "live" | "optimize";

export function LaunchControls({
  activeTask,
  onTaskChange,
}: {
  activeTask: TaskName;
  onTaskChange: (task: TaskName) => void;
}) {
  const { tasks } = useTasks();
  const activeMeta = useMemo(
    () => tasks.find((t) => t.id === activeTask),
    [tasks, activeTask],
  );
  const DEFAULT_GOAL = defaultGoalFor(activeTask, activeMeta);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [open, setOpen] = useState(true);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [busy, setBusy] = useState<null | Kind>(null);
  const [note, setNote] = useState<string>("");

  // Follow the active task's default goal when it changes (covers switches made
  // outside the tab strip, e.g. the BYO dialog setting the active task directly).
  // Keyed on the task id so it does not clobber the operator's own edits mid-task.
  const lastTaskRef = useRef(activeTask);
  useEffect(() => {
    if (lastTaskRef.current !== activeTask) {
      lastTaskRef.current = activeTask;
      setGoal(defaultGoalFor(activeTask, activeMeta));
    }
  }, [activeTask, activeMeta]);

  const post = useCallback(
    async (path: string, body: unknown, kind: Kind, label: string) => {
      setBusy(kind);
      setNote(`${label}...`);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setNote(`${label} started`);
        } else {
          setNote(
            `${label} failed (${res.status})${
              (data as { error?: string })?.error ? `: ${(data as { error?: string }).error}` : ""
            }`,
          );
        }
      } catch (err) {
        setNote(`${label} failed: ${err instanceof Error ? err.message : "network"}`);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  // Every launch carries the active task so the swarm builds (and the per-task
  // leaderboard/skill fill in for) the right target. The /api routes forward it.
  const launchRun = () =>
    post("/api/run", { goal: goal || DEFAULT_GOAL, task: activeTask }, "run", "Launch run");
  // The genuine improve_loop: resets the skill to baseline and climbs versions.
  const runClimb = () =>
    post(
      "/api/loop",
      { goal: goal || DEFAULT_GOAL, max_versions: 7, task: activeTask },
      "loop",
      "Climb",
    );
  const runLive = () =>
    post(
      "/api/live",
      { goal: goal || DEFAULT_GOAL, injections: 2, task: activeTask },
      "live",
      "Live inject",
    );
  // The open-ended optimize loop: propose a new idea each round, keep only the
  // grader-verified gains, climb the metric until genuinely stuck. Best for the byo
  // speed tasks (speedkit, algotune).
  const runOptimize = () =>
    post(
      "/api/optimize",
      { goal: goal || DEFAULT_GOAL, max_versions: 12, task: activeTask },
      "optimize",
      "Optimize",
    );

  // Switch the active task: tell the parent (so the curve + skill refetch for the
  // new task) and follow the new task's default goal in the input.
  const switchTask = useCallback(
    (task: TaskName) => {
      if (task === activeTask) return;
      onTaskChange(task);
      setGoal(defaultGoalFor(task, tasks.find((t) => t.id === task)));
      setNote("");
    },
    [activeTask, onTaskChange, tasks],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <CollapseButton open={open} onClick={() => setOpen((o) => !o)} label="controls" />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mid">
          controls
        </span>
      </div>

      {open && (
        <>
          {/* Active-task switch: which target the swarm builds and grades.
              The strip wraps onto multiple rows so every task label stays
              fully legible instead of truncating as tasks accumulate. */}
          <div className="flex items-start gap-2">
            <span className="mt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-ink-dim">
              task
            </span>
            <div
              role="tablist"
              aria-label="active task"
              className="flex flex-1 flex-wrap gap-0.5 rounded-lg border border-line bg-raised/60 p-0.5"
            >
              {tasks.map((t) => {
                const active = t.id === activeTask;
                const byo = t.kind === "byo";
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchTask(t.id)}
                    disabled={busy !== null}
                    title={byo && t.repo ? t.repo : undefined}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                      active
                        ? "bg-accent/15 text-accent shadow-[0_0_8px] shadow-accent/20"
                        : "text-ink-mid hover:text-ink"
                    }`}
                  >
                    {t.label ?? t.id}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setNewTaskOpen(true)}
                disabled={busy !== null}
                title="Bring your own repo"
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-mid transition hover:text-ink disabled:opacity-50"
              >
                + repo
              </button>
            </div>
          </div>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-raised/70 px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent/60"
            placeholder="goal"
          />
          <div className="flex gap-2">
            <button
              onClick={launchRun}
              disabled={busy !== null}
              className="flex-1 rounded-lg border border-accent/40 bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              {busy === "run" ? "Launching..." : "Launch run"}
            </button>
            <button
              onClick={runClimb}
              disabled={busy !== null}
              className="flex-1 rounded-lg border border-line bg-white/[0.04] px-3 py-2 text-xs font-semibold text-ink-mid transition hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              {busy === "loop" ? "Climbing..." : "Run climb"}
            </button>
          </div>
          <button
            onClick={runOptimize}
            disabled={busy !== null}
            className="w-full rounded-lg border border-line bg-white/[0.04] px-3 py-2 text-xs font-semibold text-ink-mid transition hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            {busy === "optimize" ? "Optimizing..." : "Optimize (open-ended)"}
          </button>
          <button
            onClick={runLive}
            disabled={busy !== null}
            className="w-full rounded-lg border border-line bg-white/[0.04] px-3 py-2 text-xs font-semibold text-ink-mid transition hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            {busy === "live" ? "Injecting..." : "Run live (inject)"}
          </button>
          {note && <span className="truncate text-[10px] text-ink-dim">{note}</span>}
        </>
      )}

      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onTaskChange={onTaskChange}
      />
    </div>
  );
}
