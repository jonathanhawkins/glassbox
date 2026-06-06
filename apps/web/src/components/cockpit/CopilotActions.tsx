"use client";

// Glassbox mission-control tools, exposed to the CopilotKit chat as frontend
// tools via the v2 useFrontendTool hook. The chat model decides when to call
// them; each launch surfaces a status card that fires the POST when it mounts,
// and the display tools surface REAL React charts in the chat thread (generative
// UI), not just text.
//
// WHY THE LAUNCH FETCH LIVES IN render(): CopilotKit 1.59.5 + AG-UI can stream
// RUN_FINISHED before a client tool handler resolves (the assistant turn that
// emits the tool call also carries the stream finish), which aborts the handler.
// The render component, however, mounts reliably from the tool-call state. So we
// fire the launch from a useEffect in the rendered card (deduped) instead of the
// handler, which makes "type the goal -> the swarm launches" work regardless of
// that lifecycle race. The on-board buttons remain an independent fallback.

import { useEffect, useRef, useState } from "react";
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

import { ChatCorrectnessCurve, ChatLeaderboard } from "./ChatCharts";

const DEFAULT_GOAL = "port the BPE tokenizer to Rust";

type LaunchResult =
  | { ok: true; kind: string; id: string }
  | { ok: false; kind: string; error: string };

// Fire a launch POST and normalize the backend response into a LaunchResult so
// the chat gets a clean, predictable summary regardless of which endpoint ran.
async function launch(
  path: string,
  body: Record<string, unknown>,
  kind: string,
): Promise<LaunchResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err =
        (data.error as string) ||
        (data.detail as string) ||
        `request failed (${res.status})`;
      return { ok: false, kind, error: err };
    }
    const id =
      (data.run_id as string) || (data.run_base as string) || "started";
    return { ok: true, kind, id };
  } catch (err) {
    return {
      ok: false,
      kind,
      error: err instanceof Error ? err.message : "network error",
    };
  }
}

// Short dedupe window so a render remount during tool-call streaming does not
// double-launch the same kind.
const recentLaunch: Record<string, number> = {};

// A self-launching status card. On mount it fires the launch POST once (deduped)
// and shows the outcome, so the launch happens even when the AG-UI run errors
// before a handler would have run.
function LaunchEffectCard({
  title,
  path,
  body,
  kind,
}: {
  title: string;
  path: string;
  body: Record<string, unknown>;
  kind: string;
}) {
  const [result, setResult] = useState<LaunchResult | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const now = Date.now();
    if (recentLaunch[kind] && now - recentLaunch[kind] < 4000) return;
    recentLaunch[kind] = now;
    void launch(path, body, kind).then(setResult);
    // launch once on mount; path/body/kind are stable for this card instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = result === null;
  const ok = pending || result.ok;

  return (
    <div
      className={`my-1 w-full rounded-xl border p-3 text-xs ${
        pending
          ? "border-slate-700/60 bg-slate-950/80 text-slate-300"
          : ok
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-200"
            : "border-rose-500/40 bg-rose-500/5 text-rose-200"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            pending
              ? "animate-pulse bg-amber-400"
              : ok
                ? "bg-emerald-400"
                : "bg-rose-400"
          }`}
        />
        <span className="font-medium">{title}</span>
      </div>
      <div className="mt-1.5 text-[11px] text-slate-400">
        {pending
          ? "dispatching to the swarm..."
          : result.ok
            ? `started (${result.id}). watch the board and the curve climb.`
            : `could not start: ${result.error}`}
      </div>
    </div>
  );
}

const goalSchema = z.object({
  goal: z
    .string()
    .describe("What to build. Defaults to porting the BPE tokenizer to Rust.")
    .optional(),
});

// The display tools take no real input, but some open-weight chat models (e.g.
// Llama 3.3 on W&B) refuse to call a tool whose parameter object is empty (they
// reply asking for more input). Giving them a single optional, self-defaulting
// argument makes the call well-formed so the model invokes them reliably.
const reasonSchema = z.object({
  reason: z
    .string()
    .describe(
      "Optional short note on why this is being shown. Defaults to 'operator request'.",
    )
    .optional(),
});

export function CopilotActions() {
  // launchRun: one full-plan graded run (climbs toward ~100% in a single pass).
  useFrontendTool({
    name: "launchRun",
    description:
      "Launch a single full-plan graded run of the agent swarm against the goal. Use this for a one-shot build that plans every capability up front.",
    parameters: goalSchema,
    handler: async () => "Launching a single graded run.",
    render: () => (
      <LaunchEffectCard
        title="Launch run"
        path="/api/run"
        body={{ goal: DEFAULT_GOAL }}
        kind="run"
      />
    ),
  });

  // launchClimb: the genuine self-improvement loop (the headline demo). The
  // backend resets SKILL.md to the incomplete baseline and rewrites it to cover
  // one more failing category per cycle, so the leaderboard climbs v1..v7 to 1.0.
  useFrontendTool({
    name: "launchClimb",
    description:
      "Run the genuine self-improvement loop: the planner starts from an incomplete baseline and rewrites its own skill to close one capability gap per version, climbing the correctness curve from v1 up to full coverage. This is the headline demo. Use it when the operator asks to port the BPE tokenizer to Rust, to improve, to climb, or to run the loop.",
    parameters: goalSchema,
    handler: async () => "Starting the self-improvement climb.",
    render: () => (
      <LaunchEffectCard
        title="Self-improvement climb"
        path="/api/loop"
        body={{ goal: DEFAULT_GOAL, max_versions: 7 }}
        kind="climb"
      />
    ),
  });

  // launchLive: the spot-a-gap inject beat. Mid-run the swarm notices a missing
  // capability, injects a bead to cover it, and accuracy jumps after the patch.
  useFrontendTool({
    name: "launchLive",
    description:
      "Run the live spot-a-gap beat: mid-run the swarm detects a missing capability, injects a new bead to cover it, and accuracy jumps after the patch lands. Use it when the operator wants to see the swarm catch and fix a gap live.",
    parameters: goalSchema,
    handler: async () => "Running the live spot-a-gap beat.",
    render: () => (
      <LaunchEffectCard
        title="Live inject beat"
        path="/api/live"
        body={{ goal: DEFAULT_GOAL, injections: 2 }}
        kind="live"
      />
    ),
  });

  // showCorrectnessCurve: generative-UI money shot. Renders the live climbing
  // curve from /api/leaderboard directly inside the chat thread.
  useFrontendTool({
    name: "showCorrectnessCurve",
    description:
      "Render the live correctness curve (accuracy vs planner version) inside the chat as a real chart. Call this directly with no extra input when the operator asks to see progress, the curve, or how the climb is going. Do not ask for clarification, just call it.",
    parameters: reasonSchema,
    handler: async () => "Rendered the correctness curve in the chat.",
    render: () => <ChatCorrectnessCurve />,
  });

  // showLeaderboard: a compact table of {version, accuracy} in the chat.
  useFrontendTool({
    name: "showLeaderboard",
    description:
      "Render the planner leaderboard (each version and its accuracy) as a small table inside the chat. Call this directly with no extra input when the operator asks for the leaderboard, the scores, or the per-version accuracy. Do not ask for clarification, just call it.",
    parameters: reasonSchema,
    handler: async () => "Rendered the leaderboard in the chat.",
    render: () => <ChatLeaderboard />,
  });

  return null;
}
