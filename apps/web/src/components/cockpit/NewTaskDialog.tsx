"use client";

// Bring-your-own-repo task creator. The operator points the swarm at a real repo
// (path or git URL), a test command (pytest for the demo), the files the workers
// may edit, and a goal. On submit it POSTs /api/tasks (which clones the repo and
// discovers its failing test groups in the background), optimistically adds the
// returned task to the switcher, and switches the cockpit to it so the board shows
// the "discovering..." state while the first eval runs.
//
// Honesty: BYO mode has NO deterministic safety net. The dialog says so plainly so
// the operator knows the score will be whatever the swarm's LLM actually achieves.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { TaskName } from "@/lib/cockpit/tasks";
import { addTaskOptimistic, refreshTasks } from "@/lib/cockpit/useTasks";

export function NewTaskDialog({
  open,
  onClose,
  onTaskChange,
}: {
  open: boolean;
  onClose: () => void;
  onTaskChange: (task: TaskName) => void;
}) {
  const [repo, setRepo] = useState("demo");
  const [testCmd, setTestCmd] = useState("pytest");
  const [editable, setEditable] = useState("**/*.py");
  const [goal, setGoal] = useState("make the failing tests pass");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Close on Escape (matches the Code drawer's affordance).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo,
          goal,
          test: testCmd,
          edit: editable ? editable.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.task?.id) {
        setError(data?.detail || data?.error || `failed (${res.status})`);
        setBusy(false);
        return;
      }
      addTaskOptimistic({ ...data.task, discovering: true });
      void refreshTasks();
      onTaskChange(data.task.id);
      setBusy(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
      setBusy(false);
    }
  }, [repo, goal, testCmd, editable, onTaskChange, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Portal to <body> so the fixed overlay escapes the cockpit's transformed
  // ancestors (a transform/filter ancestor would otherwise make `fixed` resolve
  // against that ancestor, clipping the modal into the right column).
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-accent/30 bg-panel/95 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-accent-bright">Bring your own repo</h2>
          <button
            onClick={onClose}
            className="rounded px-2 text-ink-dim hover:text-ink"
            aria-label="close"
          >
             esc
          </button>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-ink-mid">
          Point the swarm at a real repo and watch it make the failing tests pass.
          No deterministic safety net: the score is whatever the swarm actually
          achieves against your suite.
        </p>

        <label className="mb-3 block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">repo (path or git URL)</span>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            spellCheck={false}
            placeholder="demo  (or github.com/owner/name)"
            className="mt-1 w-full rounded-lg border border-line bg-raised/70 px-3 py-1.5 text-xs text-ink outline-none focus:border-accent/60"
          />
        </label>

        <div className="mb-3 flex gap-2">
          <label className="flex-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">test command</span>
            <input
              value={testCmd}
              onChange={(e) => setTestCmd(e.target.value)}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-line bg-raised/70 px-3 py-1.5 text-xs text-ink outline-none focus:border-accent/60"
            />
          </label>
          <label className="flex-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">editable glob</span>
            <input
              value={editable}
              onChange={(e) => setEditable(e.target.value)}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-line bg-raised/70 px-3 py-1.5 text-xs text-ink outline-none focus:border-accent/60"
            />
          </label>
        </div>

        <label className="mb-4 block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">goal</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-line bg-raised/70 px-3 py-1.5 text-xs text-ink outline-none focus:border-accent/60"
          />
        </label>

        {error && <p className="mb-3 text-[11px] text-fail">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-line bg-raised/50 px-3 py-1.5 text-[11px] font-medium text-ink-mid hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !repo.trim()}
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? "Cloning + discovering..." : "Create + discover"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
