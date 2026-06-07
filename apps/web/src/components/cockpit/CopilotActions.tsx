"use client";

// Glassbox mission-control tools, exposed to the CopilotKit chat as frontend
// tools via the v2 useFrontendTool / useHumanInTheLoop hooks. The chat model
// decides when to call them; each tool renders a REAL React artifact in the
// thread (generative UI), not just text:
//   - launch tools render a self-launching status card,
//   - proposeImprovement renders an interactive human-in-the-loop approval card
//     (Approve / Decline) and pauses the agent until the operator decides,
//   - the display tools render live charts (the correctness curve / leaderboard).
//
// WHY THE LAUNCH FETCH LIVES IN render(): CopilotKit 1.59.5 + AG-UI can stream
// RUN_FINISHED before a client tool handler resolves (the assistant turn that
// emits the tool call also carries the stream finish), which aborts the handler.
// The render component, however, mounts reliably from the tool-call state. So we
// fire the launch from a useEffect in the rendered card (deduped) instead of the
// handler, which makes "type the goal -> the swarm launches" work regardless of
// that lifecycle race. The on-board buttons remain an independent fallback.
//
// The human-in-the-loop card is exempt from that race: its launch fires from the
// operator's Approve click (a DOM event), then resolves the agent via respond().

import { useEffect, useRef, useState } from "react";
import { useFrontendTool, useHumanInTheLoop } from "@copilotkit/react-core/v2";
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

// ---------------------------------------------------------------------------
// Shared in-thread artifact shell. Keeps every generative-UI card visually
// consistent: a rounded glass panel with a status dot, a title, and a body.
// ---------------------------------------------------------------------------

type Tone = "pending" | "ok" | "bad" | "muted" | "accent";

const TONE_FRAME: Record<Tone, string> = {
  pending: "border-slate-700/60 bg-slate-950/80 text-slate-200",
  ok: "border-emerald-500/40 bg-emerald-500/5 text-emerald-100",
  bad: "border-rose-500/40 bg-rose-500/5 text-rose-100",
  muted: "border-slate-700/60 bg-slate-900/50 text-slate-300",
  accent: "border-amber-500/40 bg-amber-500/[0.06] text-amber-100",
};

const TONE_DOT: Record<Tone, string> = {
  pending: "animate-pulse bg-amber-400",
  ok: "bg-emerald-400",
  bad: "bg-rose-400",
  muted: "bg-slate-500",
  accent: "bg-amber-400 shadow-[0_0_8px] shadow-amber-400/60",
};

function ArtifactCard({
  tone,
  title,
  eyebrow,
  children,
}: {
  tone: Tone;
  title: string;
  eyebrow?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`my-1 w-full rounded-xl border p-3 text-xs ${TONE_FRAME[tone]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
        <span
          className={
            eyebrow
              ? "text-[10px] font-medium uppercase tracking-[0.16em]"
              : "font-medium"
          }
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-launching status card (generative UI for the fire-and-forget launches).
// On mount it fires the launch POST once (deduped) and shows the outcome, so the
// launch happens even when the AG-UI run errors before a handler would have run.
// ---------------------------------------------------------------------------

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
  const tone: Tone = pending ? "pending" : result.ok ? "ok" : "bad";

  return (
    <ArtifactCard tone={tone} title={title}>
      <div className="mt-1.5 text-[11px] text-slate-400">
        {pending
          ? "dispatching to the swarm..."
          : result.ok
            ? `started (${result.id}). watch the board and the curve climb.`
            : `could not start: ${result.error}`}
      </div>
    </ArtifactCard>
  );
}

// ---------------------------------------------------------------------------
// Human-in-the-loop approval card. The agent proposes the next self-improvement
// step; this renders interactive Approve / Decline controls and pauses the run
// until the operator decides. Approve fires the real climb and resolves the
// agent via respond(); Decline resolves with a hold message. This is the
// headline CopilotKit capability: the agent yields to the operator mid-run and
// renders the decision UI as a live artifact in the thread.
// ---------------------------------------------------------------------------

function ImprovementApprovalCard({
  plan,
  respond,
  result,
}: {
  plan?: string;
  respond?: (result: unknown) => Promise<void>;
  result?: string;
}) {
  const [phase, setPhase] = useState<"idle" | "approving" | "declining">("idle");
  const awaiting = typeof respond === "function";
  const planText =
    plan?.trim() ||
    "Rewrite the planner skill to close the next failing category, then re-grade and climb the curve.";

  // Resolved (Complete): the operator decided; result holds our summary.
  if (!awaiting && result != null) {
    const declined = /declin/i.test(result);
    return (
      <ArtifactCard
        tone={declined ? "muted" : "ok"}
        title={declined ? "Improvement declined" : "Improvement approved"}
      >
        <div className="mt-1.5 text-[11px] text-slate-400">{result}</div>
      </ArtifactCard>
    );
  }

  // Preparing (InProgress): the model is still forming the proposal.
  if (!awaiting) {
    return <ArtifactCard tone="pending" title="Preparing proposal..." />;
  }

  // Awaiting decision (Executing): interactive approval controls.
  const onApprove = async () => {
    if (!respond) return;
    setPhase("approving");
    const r = await launch("/api/loop", { goal: DEFAULT_GOAL, max_versions: 7 }, "climb");
    await respond(
      r.ok
        ? `Operator approved. Self-improvement climb started (${r.id}). Watch the board and the curve climb.`
        : `Operator approved, but the launch failed: ${r.error}`,
    );
  };
  const onDecline = async () => {
    if (!respond) return;
    setPhase("declining");
    await respond("Operator declined. Holding at the current planner version.");
  };

  const busy = phase !== "idle";
  return (
    <ArtifactCard tone="accent" title="approval required" eyebrow>
      <p className="mt-2 text-[12px] leading-relaxed text-slate-200">{planText}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="flex-1 rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-[12px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === "approving" ? "Launching..." : "Approve & launch"}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy}
          className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-1.5 text-[12px] font-medium text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === "declining" ? "..." : "Decline"}
        </button>
      </div>
    </ArtifactCard>
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

const proposeSchema = z.object({
  plan: z
    .string()
    .describe(
      "One short sentence describing the improvement you propose, e.g. 'Close the next failing category, then re-grade and climb the curve.'",
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
      "Run the genuine self-improvement loop immediately: the planner starts from an incomplete baseline and rewrites its own skill to close one capability gap per version, climbing the correctness curve from v1 up to full coverage. This is the headline demo. Use it when the operator clearly wants to start now: 'port the BPE tokenizer to Rust', 'run the loop', 'climb', 'just run it', or 'go'. If the operator instead wants to review or approve the plan first, call proposeImprovement.",
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

  // proposeImprovement: HUMAN-IN-THE-LOOP. The agent proposes the next
  // self-improvement step and waits for the operator to Approve or Decline in an
  // interactive card before anything launches. Approval fires the real climb.
  useHumanInTheLoop({
    name: "proposeImprovement",
    description:
      "Propose the next self-improvement step and ask the operator to APPROVE before the swarm rewrites its own planner skill and climbs. Use when the operator wants to review or sign off first: 'propose the next improvement', 'what should we do next', 'suggest an improvement and let me approve', 'ask me before you run'. This renders an interactive approval card and PAUSES until the operator decides. Do not also call launchClimb; approval launches the climb for you.",
    parameters: proposeSchema,
    render: ({ args, respond, result }) => (
      <ImprovementApprovalCard
        plan={args.plan}
        respond={respond}
        result={typeof result === "string" ? result : undefined}
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
