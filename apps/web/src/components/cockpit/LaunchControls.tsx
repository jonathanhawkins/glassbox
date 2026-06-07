"use client";

// Launch controls (the always-available fallback to the chat command bar).
// POST /api/run kicks one graded run; POST /api/loop runs the genuine
// self-improvement climb (the headline demo); POST /api/live runs the
// spot-a-gap inject beat. A small goal input retargets the swarm without code.
//
// The TASK switcher picks which target the swarm builds: "tokenizer" (the Rust
// BPE port, graded by an exact oracle) or "kata" (a Python textkit library,
// graded by pytest). The selected task is owned by the cockpit and threaded into
// every launch body (the /api routes forward it), so a run, climb, live inject,
// or reset all target the active task.

import { useCallback, useState } from "react";

import { TASK_GOALS, type TaskName } from "@/lib/cockpit/tasks";

type Kind = "run" | "loop" | "live" | "reset";

const TASKS: { id: TaskName; label: string }[] = [
  { id: "tokenizer", label: "tokenizer" },
  { id: "kata", label: "kata" },
];

export function LaunchControls({
  activeTask,
  onTaskChange,
}: {
  activeTask: TaskName;
  onTaskChange: (task: TaskName) => void;
}) {
  const DEFAULT_GOAL = TASK_GOALS[activeTask];
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [busy, setBusy] = useState<null | Kind>(null);
  const [note, setNote] = useState<string>("");

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

  // Switch the active task: tell the parent (so the curve + skill refetch for the
  // new task) and follow the new task's default goal in the input.
  const switchTask = useCallback(
    (task: TaskName) => {
      if (task === activeTask) return;
      onTaskChange(task);
      setGoal(TASK_GOALS[task]);
      setNote("");
    },
    [activeTask, onTaskChange],
  );

  // Reset clears the live curve/board so the demo can restart clean, then reloads
  // so the cockpit re-hydrates from the cleared state.
  const resetBoard = useCallback(async () => {
    setBusy("reset");
    setNote("Resetting...");
    try {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: activeTask }),
      });
      if (res.ok) {
        setNote("reset");
        window.location.reload();
      } else {
        setNote(`reset failed (${res.status})`);
        setBusy(null);
      }
    } catch (err) {
      setNote(`reset failed: ${err instanceof Error ? err.message : "network"}`);
      setBusy(null);
    }
  }, [activeTask]);

  return (
    <div className="flex flex-col gap-2">
      {/* Active-task switch: which target the swarm builds and grades. */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
          task
        </span>
        <div
          role="tablist"
          aria-label="active task"
          className="flex flex-1 rounded-lg border border-slate-700/70 bg-slate-900/60 p-0.5"
        >
          {TASKS.map((t) => {
            const active = t.id === activeTask;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchTask(t.id)}
                disabled={busy !== null}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                  active
                    ? "bg-cyan-500/15 text-cyan-200 shadow-[0_0_8px] shadow-cyan-500/20"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <input
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        spellCheck={false}
        className="w-full rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
        placeholder="goal"
      />
      <div className="flex gap-2">
        <button
          onClick={launchRun}
          disabled={busy !== null}
          className="flex-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {busy === "run" ? "Launching..." : "Launch run"}
        </button>
        <button
          onClick={runClimb}
          disabled={busy !== null}
          className="flex-1 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 disabled:opacity-50"
        >
          {busy === "loop" ? "Climbing..." : "Run climb"}
        </button>
      </div>
      <button
        onClick={runLive}
        disabled={busy !== null}
        className="w-full rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
      >
        {busy === "live" ? "Injecting..." : "Run live (inject)"}
      </button>
      <button
        onClick={resetBoard}
        disabled={busy !== null}
        className="w-full rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-[11px] font-medium text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200 disabled:opacity-50"
      >
        {busy === "reset" ? "Resetting..." : "Reset board"}
      </button>
      {note && <span className="truncate text-[10px] text-slate-500">{note}</span>}
    </div>
  );
}
