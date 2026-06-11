// The loop kernel (v1, client-side). Drives a voxherd worker through an archetype loop:
// send the step -> wait for the bridge's real agent_event:stop (turn done) -> scan the
// worker's output for a LOOP_DONE sentinel (it self-reports + verifies) -> continue, or
// stop on done / a round budget / the user. Phase 2 moves this server-side with a cron
// trigger and a pluggable agentic validator; the contract here stays the same.
//
// Note on imports: the real I/O seams (./client, ./ws) and the pure kernel (./loop-core) are
// pulled in lazily via dynamic import() rather than static, extensionless imports. That keeps
// this module loadable by Node's built-in test runner (which cannot resolve extensionless
// relative specifiers): a test injects fake deps, so the real ./client + ./ws are never
// imported under test. The bundler (Next) resolves the dynamic specifiers normally in prod.

import type { sendCommand as sendCommandReal } from "./client";
import type { openTerminalStream as openTerminalStreamReal } from "./ws";
import type { Archetype } from "@/lib/fleet/archetypes";

// The two I/O seams the loop drives, factored out so a test can inject fakes. Both default to
// the real voxherd client + ws implementations, so production callers pass no deps.
type SendCommandFn = typeof sendCommandReal;
type OpenTerminalStreamFn = typeof openTerminalStreamReal;

export interface LoopDeps {
  sendCommand?: SendCommandFn;
  openTerminalStream?: OpenTerminalStreamFn;
}

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

export function startArchetypeLoop(
  opts: {
    session: { project: string; session_id: string };
    archetype: Archetype;
    goal: string;
    workers?: number;
    maxRounds?: number;
    onState: (s: LoopState) => void;
  },
  deps?: LoopDeps,
): LoopHandle {
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

  // Bootstrap: resolve the pure kernel + the I/O seams (injected fakes, or the real
  // ./client + ./ws via dynamic import), then open the stream and run the first round.
  // This mirrors the original openStream().then(...) flow; the only addition is awaiting
  // the lazily-imported modules first. Behavior (state emissions, ordering) is unchanged.
  void (async () => {
    const { buildStepPrompt, hasDoneToken } = await import("./loop-core.ts");
    const send: SendCommandFn =
      deps?.sendCommand ?? (await import("./client.ts")).sendCommand;
    const openStream: OpenTerminalStreamFn =
      deps?.openTerminalStream ?? (await import("./ws.ts")).openTerminalStream;

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
      const r = await send({
        project: session.project,
        session_id: session.session_id,
        message: buildStepPrompt(archetype, goal, round, workers),
      });
      if (!r.ok) finish(`send failed: ${r.error ?? "?"}`);
    };

    const onStop = (summary: string) => {
      if (stopped || !awaitingStop) return;
      awaitingStop = false;
      lastSummary = summary;
      // recent holds RAW (ANSI-laden) lines from the stream; hasDoneToken strips escapes before
      // the sentinel scan so an embedded color code can't split or hide the LOOP_DONE token.
      if (hasDoneToken(recent, summary)) {
        finish("done");
        return;
      }
      emit();
      void runRound();
    };

    const fn = await openStream(
      session.session_id,
      (lines) => {
        recent = lines;
      },
      onStop,
    );
    if (stopped) fn();
    else {
      cleanup = fn;
      void runRound();
    }
  })();

  return { stop: () => finish("stopped") };
}
