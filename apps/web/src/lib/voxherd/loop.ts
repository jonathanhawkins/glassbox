// The loop kernel (v1, client-side). Drives a voxherd worker through an archetype loop:
// send the step -> wait for the bridge's real agent_event:stop (turn done) -> scan the
// worker's output for a LOOP_DONE sentinel (it self-reports + verifies) -> continue, or
// stop on done / a round budget / the user. Phase 2 moves this server-side with a cron
// trigger and a pluggable agentic validator; the contract here stays the same.

import { sendCommand } from "./client";
import { openTerminalStream, stripAnsi } from "./ws";
import type { Archetype } from "@/lib/fleet/archetypes";

export interface LoopState {
  running: boolean;
  round: number;
  maxRounds: number;
  archetype: string;
  /** Canonical loop-shape id (contract "archetypes"), for the board overlay. */
  archetypeId: string;
  lastSummary: string;
  reason: string; // "" while running, else done | max rounds | stopped | <error>
}

export interface LoopHandle {
  stop: () => void;
}

const DONE_TOKEN = "LOOP_DONE";

export function startArchetypeLoop(opts: {
  session: { project: string; session_id: string };
  archetype: Archetype;
  goal: string;
  workers?: number;
  maxRounds?: number;
  onState: (s: LoopState) => void;
}): LoopHandle {
  const { session, archetype, goal, onState } = opts;
  const workers = opts.workers ?? 4;
  const maxRounds = opts.maxRounds ?? 8;
  let round = 0;
  let stopped = false;
  let awaitingStop = false;
  let lastSummary = "";
  let recent: string[] = [];
  let cleanup: (() => void) | undefined;

  const emit = (reason = "") =>
    onState({
      running: !stopped,
      round,
      maxRounds,
      archetype: archetype.name,
      archetypeId: archetype.id,
      lastSummary,
      reason,
    });

  const finish = (reason: string) => {
    if (stopped) return;
    stopped = true;
    cleanup?.();
    emit(reason);
  };

  const stepPrompt = (n: number): string => {
    const head = n === 1 ? archetype.kickoff(goal) : `Continue toward the goal: ${goal}.`;
    return (
      `${head}\n\nUse up to ${workers} sub-agents working in parallel this round. This is round ` +
      `${n} of an automated ${archetype.name} loop. When the goal is fully met and verified, end ` +
      `your reply with the exact token ${DONE_TOKEN}. If work remains, end with LOOP_CONTINUE and ` +
      `a one-line note on what is left.`
    );
  };

  const runRound = async () => {
    if (stopped) return;
    round += 1;
    if (round > maxRounds) {
      finish("max rounds");
      return;
    }
    recent = [];
    awaitingStop = true;
    emit();
    const r = await sendCommand({
      project: session.project,
      session_id: session.session_id,
      message: stepPrompt(round),
    });
    if (!r.ok) finish(`send failed: ${r.error ?? "?"}`);
  };

  const onStop = (summary: string) => {
    if (stopped || !awaitingStop) return;
    awaitingStop = false;
    lastSummary = summary;
    // recent now holds RAW (ANSI-laden) lines from the stream; strip escapes before the
    // sentinel scan so an embedded color code can't split or hide the LOOP_DONE token.
    const text = `${recent.map(stripAnsi).join("\n")}\n${summary}`.toUpperCase();
    if (text.includes(DONE_TOKEN)) {
      finish("done");
      return;
    }
    emit();
    void runRound();
  };

  void openTerminalStream(
    session.session_id,
    (lines) => {
      recent = lines;
    },
    onStop,
  ).then((fn) => {
    if (stopped) fn();
    else {
      cleanup = fn;
      void runRound();
    }
  });

  return { stop: () => finish("stopped") };
}
