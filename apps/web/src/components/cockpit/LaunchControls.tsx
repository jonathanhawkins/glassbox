"use client";

// Launch controls (the always-available fallback to the chat command bar).
// POST /api/run kicks one graded run; POST /api/loop runs the genuine
// self-improvement climb (the headline demo); POST /api/live runs the
// spot-a-gap inject beat. A small goal input retargets the swarm without code.

import { useCallback, useState } from "react";

const DEFAULT_GOAL = "port the BPE tokenizer to Rust";

type Kind = "run" | "loop" | "live";

export function LaunchControls() {
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

  const launchRun = () =>
    post("/api/run", { goal: goal || DEFAULT_GOAL }, "run", "Launch run");
  // The genuine improve_loop: resets the skill to baseline and climbs versions.
  const runClimb = () =>
    post("/api/loop", { goal: goal || DEFAULT_GOAL, max_versions: 7 }, "loop", "Climb");
  const runLive = () =>
    post("/api/live", { goal: goal || DEFAULT_GOAL, injections: 2 }, "live", "Live inject");

  return (
    <div className="flex flex-col gap-2">
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
          {busy === "loop" ? "Climbing..." : "Run climb x5"}
        </button>
      </div>
      <button
        onClick={runLive}
        disabled={busy !== null}
        className="w-full rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
      >
        {busy === "live" ? "Injecting..." : "Run live (inject)"}
      </button>
      {note && <span className="truncate text-[10px] text-slate-500">{note}</span>}
    </div>
  );
}
