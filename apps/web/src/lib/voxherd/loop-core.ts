// Pure, self-contained kernel of the archetype loop: the two decisions that drive a round
// (what prompt to send, and whether the worker has signalled it is done). Kept free of any
// I/O and of extensionless relative imports so native node:test can load it directly. loop.ts
// is the single caller and stays the one source of truth by importing from here.

import type { Archetype } from "@/lib/fleet/archetypes";

/** The sentinel a worker ends its reply with once the goal is met and verified. */
export const DONE_TOKEN = "LOOP_DONE";

/**
 * Strip ANSI escape sequences (CSI + OSC) so a color code embedded mid-stream can't split or
 * hide the LOOP_DONE token. Inlined here (mirrors ws.ts's stripAnsi) to keep this module
 * self-contained with no extensionless relative import.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
}

/**
 * Build the prompt sent to the conductor for a given round. Round 1 opens with the archetype's
 * kickoff; later rounds just nudge it to continue. Both get the same suffix carrying the worker
 * budget, the round/archetype context, and the LOOP_DONE / LOOP_CONTINUE protocol.
 */
export function buildStepPrompt(
  archetype: Archetype,
  goal: string,
  round: number,
  workers: number,
): string {
  const head = round === 1 ? archetype.kickoff(goal) : `Continue toward the goal: ${goal}.`;
  return (
    `${head}\n\nUse up to ${workers} sub-agents working in parallel this round. This is round ` +
    `${round} of an automated ${archetype.name} loop. When the goal is fully met and verified, end ` +
    `your reply with the exact token ${DONE_TOKEN}. If work remains, end with LOOP_CONTINUE and ` +
    `a one-line note on what is left.`
  );
}

/**
 * Decide whether the worker has signalled completion: strip ANSI from the recent (raw) output
 * lines, fold in the turn summary, uppercase the whole thing, and check for the DONE token.
 * Case-insensitive (via uppercase) and resilient to embedded escape codes.
 */
export function hasDoneToken(lines: string[], summary: string): boolean {
  const text = `${lines.map(stripAnsi).join("\n")}\n${summary}`.toUpperCase();
  return text.includes(DONE_TOKEN);
}
