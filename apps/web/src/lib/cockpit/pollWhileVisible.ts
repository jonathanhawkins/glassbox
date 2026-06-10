"use client";

// Visibility-aware polling for the cockpit/fleet/deck pollers.
//
// The shared pollers (useLeaderboard, useTasks, useSessions) and the standalone
// deck curve each run a 1.5s setInterval for the whole tab lifetime. With nothing
// gating them on visibility, a backgrounded cockpit, board, swarm, or projector
// deck keeps hammering the bridge every 1.5s for output nobody is looking at.
// Pausing while the tab is hidden is the single biggest "every page" win: it cuts
// background request volume to zero and resumes (with an immediate refresh) the
// moment the operator returns to the tab.
//
// Usage mirrors a raw setInterval but returns a stop() that clears BOTH the timer
// and the visibilitychange listener:
//
//   const stop = pollWhileVisible(pollAll, 1500);
//   // ...later, when the last subscriber unmounts:
//   stop();
//
// The recurring `fn` only fires while the tab is visible. Callers still do their
// own immediate fetch on mount (as before); this util adds the recurring tick and
// a single catch-up `fn()` when the tab transitions hidden -> visible.

export function pollWhileVisible(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (!timer) timer = setInterval(fn, ms);
  };
  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibility = () => {
    if (document.hidden) {
      stop();
    } else {
      // Catch up immediately on return so the operator never sees a stale value
      // for up to a full interval, then resume the steady tick.
      fn();
      start();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  if (!document.hidden) start();

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
