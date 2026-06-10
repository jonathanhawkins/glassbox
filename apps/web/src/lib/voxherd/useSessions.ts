"use client";

// Shared, reference-counted poller for the live voxherd session list. FleetView and
// SessionDetail previously each ran their own 1.5s `/api/sessions` poll, so mounting
// (or navigating between) them meant independent request streams hammering the bridge.
// A module-level store + subscriber set (the same pattern as useTasks) collapses every
// mounted consumer onto ONE interval and ONE in-flight fetch, and only notifies
// subscribers when the payload actually changes, so an idle tick triggers zero
// re-renders of the live grid / console.

import { useEffect, useState } from "react";

import { fetchSessions } from "./client";
import type { VoxSession } from "./types";

let store: VoxSession[] = [];
let snapshot = ""; // serialized last payload; gate notifications on a real change
let loaded = false;
let error = "";
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
}

let inFlight: Promise<void> | null = null;

/** Fetch the session list once, collapsing concurrent callers onto a single request
 * and only notifying subscribers when something actually changed. */
export async function refreshSessions(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const next = await fetchSessions();
      const nextSnapshot = JSON.stringify(next);
      const hadError = error !== "";
      error = "";
      if (nextSnapshot !== snapshot) {
        snapshot = nextSnapshot;
        store = next;
        loaded = true;
        emit();
      } else if (!loaded || hadError) {
        // First successful load, or recovery from an error: notify once even though
        // the payload itself is unchanged so consumers clear their error banner.
        loaded = true;
        emit();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "unreachable";
      loaded = true;
      emit();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => void refreshSessions(), 1500);
}

function maybeStopPolling() {
  if (subs.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export type UseSessions = { sessions: VoxSession[]; loaded: boolean; error: string };

/** Subscribe to the shared live session list. The interval runs only while at least
 * one component is mounted (reference-counted), and re-renders fire only on change. */
export function useSessions(): UseSessions {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    subs.add(rerender);
    ensurePolling();
    void refreshSessions(); // kick an immediate fetch on mount
    return () => {
      subs.delete(rerender);
      maybeStopPolling();
    };
  }, []);

  return { sessions: store, loaded, error };
}
