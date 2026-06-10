"use client";

// Centralized transport for the swarm: Play, Pause, Stop, Reset, pinned to the
// top middle of the cockpit header. It is the single place an operator drives a
// run, so the side controls no longer carry Stop or Reset.
//
// Wiring (all cooperative, never mid-bead):
//   Play  -> resume a paused run (/api/resume) or launch a fresh one (/api/run)
//   Pause -> hold at the next wave/version boundary (/api/pause), keeps the lock
//   Stop  -> cancel at the next boundary (/api/stop), releases the lock
//   Reset -> clear the live board (/api/reset) and re-hydrate
//
// It owns its own /api/status poll ({ running, paused }) so the pills light up
// accurately even across loop-version gaps, independent of the SSE stream.

import { useCallback, useEffect, useRef, useState } from "react";

import { defaultGoalFor, type TaskName } from "@/lib/cockpit/tasks";

type Phase = "idle" | "running" | "paused";

export function ControlPanel({
  activeTask,
  goal,
}: {
  activeTask: TaskName;
  goal?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  // Latch a button press so the UI reacts instantly while the next status poll
  // (up to ~1.5s away) catches up. Cleared on the first poll that confirms it.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Poll the backend run lock + pause flag so the transport reflects real state
  // across loop-version gaps (where event-derived state would flicker).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = (await res.json()) as { running?: boolean; paused?: boolean };
        if (!alive) return;
        const next: Phase = data.paused
          ? "paused"
          : data.running
            ? "running"
            : "idle";
        setPhase(next);
        // The poll has caught up to the latched intent: release the busy latch.
        if (busyRef.current) {
          busyRef.current = false;
          setBusy(false);
        }
      } catch {
        if (alive) setPhase("idle");
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const fire = useCallback(
    async (path: string, body?: unknown, optimistic?: Phase) => {
      busyRef.current = true;
      setBusy(true);
      if (optimistic) setPhase(optimistic);
      try {
        await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        // The status poll resyncs regardless; drop the latch so we are not stuck.
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  // Play doubles as resume: continue a paused run, otherwise launch a fresh one.
  const onPlay = useCallback(() => {
    if (phase === "paused") {
      void fire("/api/resume", undefined, "running");
    } else if (phase === "idle") {
      void fire(
        "/api/run",
        { goal: goal || defaultGoalFor(activeTask), task: activeTask },
        "running",
      );
    }
  }, [phase, fire, goal, activeTask]);

  const onPause = useCallback(() => {
    void fire("/api/pause", undefined, "paused");
  }, [fire]);

  const onStop = useCallback(() => {
    void fire("/api/stop", undefined, "idle");
  }, [fire]);

  // Reset clears the live curve/board so the demo restarts clean, then reloads so
  // the cockpit re-hydrates from the cleared state.
  const onReset = useCallback(async () => {
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: activeTask }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        busyRef.current = false;
        setBusy(false);
      }
    } catch {
      busyRef.current = false;
      setBusy(false);
    }
  }, [activeTask]);

  const running = phase === "running";
  const paused = phase === "paused";
  const idle = phase === "idle";

  // Play is live when there is something to start (idle) or resume (paused).
  const canPlay = (idle || paused) && !busy;
  const canPause = running && !busy;
  const canStop = (running || paused) && !busy;
  const canReset = idle && !busy;

  const label = busy
    ? "working..."
    : paused
      ? "paused"
      : running
        ? "running"
        : "idle";
  const dot = paused
    ? "bg-ink-dim"
    : running
      ? "bg-accent animate-pulse"
      : "bg-ink-faint";

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel/70 px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur">
        <TransportButton
          onClick={onPlay}
          disabled={!canPlay}
          title={paused ? "Resume the run" : "Launch a run"}
          tone="emerald"
        >
          <PlayIcon />
        </TransportButton>
        <TransportButton
          onClick={onPause}
          disabled={!canPause}
          title="Pause at the next boundary"
          tone="amber"
        >
          <PauseIcon />
        </TransportButton>
        <TransportButton
          onClick={onStop}
          disabled={!canStop}
          title="Stop the run"
          tone="rose"
        >
          <StopIcon />
        </TransportButton>
        <span className="mx-0.5 h-6 w-px bg-line" aria-hidden="true" />
        <TransportButton
          onClick={onReset}
          disabled={!canReset}
          title="Reset the board"
          tone="slate"
        >
          <ResetIcon />
        </TransportButton>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-ink-dim">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
    </div>
  );
}

type Tone = "emerald" | "amber" | "rose" | "slate";

// Transport tones, on the disciplined system: play is the one accent (primary
// launch), stop is fail-red, pause and reset are calm neutral outlines. The Tone
// key names are kept so call sites need no change.
const TONES: Record<Tone, string> = {
  emerald:
    "border-accent/40 bg-accent/15 text-accent hover:bg-accent/20",
  amber:
    "border-line bg-white/[0.04] text-ink-mid hover:bg-raised hover:text-ink",
  rose: "border-fail/40 bg-fail/10 text-fail hover:bg-fail/20",
  slate:
    "border-line bg-white/[0.04] text-ink-mid hover:bg-raised hover:text-ink",
};

function TransportButton({
  onClick,
  disabled,
  title,
  tone,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`grid h-9 w-9 place-items-center rounded-lg border transition active:scale-95 disabled:cursor-not-allowed disabled:border-line disabled:bg-raised/40 disabled:text-ink-faint disabled:hover:bg-raised/40 ${TONES[tone]}`}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M4.5 3.2 12.5 8 4.5 12.8z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <rect x="4" y="3.2" width="3" height="9.6" rx="0.8" />
      <rect x="9" y="3.2" width="3" height="9.6" rx="0.8" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.4" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4" />
      <path d="M12.4 2.4 12 4.8 9.6 4.4" />
    </svg>
  );
}
