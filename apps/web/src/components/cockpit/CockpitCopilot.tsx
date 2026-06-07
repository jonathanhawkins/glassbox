"use client";

// The CopilotKit command bar for the Glassbox cockpit. Wraps the chat in the
// v2 provider, registers the mission-control tools, and renders an embedded
// CopilotChat themed to match the dark glass dock. The model (W&B Inference, a
// standard instruct model) decides when to call launchRun / launchClimb /
// launchLive, when to ask for approval via proposeImprovement (human in the
// loop), and when to render the correctness curve / leaderboard as generative
// UI inside the thread.
//
// VERSION: @copilotkit/runtime 1.59.x mounts the v2 single-route endpoint via
// copilotRuntimeNextJSAppRouterEndpoint, so the client uses the matching v2
// React stack: CopilotKitProvider + CopilotChat + useFrontendTool +
// useConfigureSuggestions, with the v2 stylesheet.
//
// LAYOUT: instead of fighting the default chat empty-state with !important CSS,
// we drive the v2 slot system directly. A custom `welcomeScreen` renders a
// tight, on-brand intro + suggestion pills + the composer; `input` hides the
// stock disclaimer; `suggestionView` restyles the prompt chips into compact
// pills. This is what keeps the narrow (~360px) dock calm and uncluttered.
//
// Imported by CockpitBoard via next/dynamic { ssr: false } so the runtime
// client and chat widget never run during server rendering.

import {
  CopilotKitProvider,
  CopilotChat,
  useAgentContext,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type { CSSProperties, ReactElement } from "react";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotActions } from "./CopilotActions";

const SYSTEM_INSTRUCTIONS = [
  "You are Glassbox mission control: the operator's copilot for a self-improving agent swarm that ports a BPE tokenizer to Rust and grades itself against a hard oracle (exact token-id match).",
  "To start a build, call the launch tools. Do not just describe what you would do, actually call the tool.",
  "Use launchClimb for the genuine self-improvement loop run immediately (the headline demo): 'port the BPE tokenizer to Rust', 'improve', 'climb', 'run the loop', 'just run it', or 'go' should call launchClimb.",
  "Use proposeImprovement (human in the loop) when the operator wants to review or sign off before anything runs: 'propose the next improvement', 'what should we do next', or 'ask me before you run'. It renders an approval card and waits; approval launches the climb, so do not also call launchClimb.",
  "Use launchRun for a single full-plan one-shot run, and launchLive for the spot-a-gap inject beat where the swarm catches and patches a missing capability mid-run.",
  "To show progress, render the charts: call showCorrectnessCurve to draw the climbing accuracy curve in the chat, and showLeaderboard to show the per-version accuracy table.",
  "Keep replies short and concrete. After launching, tell the operator to watch the board and the curve climb.",
].join(" ");

// Mission steering for the model. In v2 there is no system-prompt prop on the
// chat, so the operating instructions are injected as agent context (the model
// sees this alongside the tool descriptions).
function MissionContext() {
  useAgentContext({
    description: "Glassbox mission control operating instructions",
    value: SYSTEM_INSTRUCTIONS,
  });
  return null;
}

// Static prompt chips shown before the first message. These double as a tour of
// what the copilot (and the SDK) can do: launch, human-in-the-loop approval,
// and generative-UI charts.
function Suggestions() {
  useConfigureSuggestions(
    {
      available: "before-first-message",
      suggestions: [
        {
          title: "Port the BPE tokenizer to Rust",
          message: "Port the BPE tokenizer to Rust",
        },
        {
          title: "Propose the next improvement",
          message: "Propose the next improvement and ask me to approve it",
        },
        {
          title: "Show the correctness curve",
          message: "Show the correctness curve",
        },
      ],
    },
    [],
  );
  return null;
}

// Branded empty state. Receives the composer and suggestion elements from the
// chat view and lays them out tightly for the narrow dock: a calm one-line
// intro, the suggestion pills, and the composer pinned to the bottom. Replaces
// the stock centered welcome headline (which read like a page title in the rail)
// and stops the prompt chips from overflowing the panel.
function MissionWelcome({
  input,
  suggestionView,
}: {
  input: ReactElement;
  suggestionView: ReactElement;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
        <p className="max-w-[34ch] text-[12.5px] leading-relaxed text-slate-400">
          Type a goal and the swarm plans, builds, and grades itself against a
          hard oracle, then rewrites its own skill to climb the curve.
        </p>
        <div className="mb-1.5 mt-4 text-[9.5px] font-medium uppercase tracking-[0.2em] text-slate-600">
          try
        </div>
        {suggestionView}
      </div>
      <div className="shrink-0 px-2 pb-2 pt-1.5">{input}</div>
    </div>
  );
}

// Compact, left-aligned prompt pills (overrides the default full-width stacked
// buttons that overflowed the dock).
const SUGGESTION_SLOTS = {
  container: "flex flex-col gap-1.5",
  suggestion:
    "w-full justify-start whitespace-normal rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-left text-[12.5px] font-normal normal-case text-slate-300 transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/[0.07] hover:text-cyan-100",
} as const;

// Hide the stock "AI can make mistakes" disclaimer in the demo dock.
const INPUT_SLOTS = { showDisclaimer: false } as const;

// Dark glass theme. The v2 chat reads design tokens; we apply the .dark token
// set and override a few to match the cockpit palette (cyan primary on
// near-black slate).
const CHAT_THEME: CSSProperties = {
  // Match the cockpit typography: the v2 chat defaults to system ui-sans-serif,
  // which renders large and out of character next to the Geist-based cockpit.
  // The chat resolves --cpk-default-font-family from --cpk-font-sans at :root,
  // so the already-resolved default tokens are what we override here (setting
  // --cpk-font-sans alone would not re-resolve). Point them at Geist.
  ["--cpk-default-font-family" as string]:
    "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  ["--cpk-default-mono-font-family" as string]:
    "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  // Cockpit-flavored overrides of the v2 design tokens.
  ["--background" as string]: "oklch(13% 0.02 250)",
  ["--card" as string]: "oklch(15% 0.02 250)",
  ["--popover" as string]: "oklch(15% 0.02 250)",
  ["--border" as string]: "oklch(30% 0.03 230 / 0.5)",
  ["--input" as string]: "oklch(22% 0.03 240)",
  ["--primary" as string]: "oklch(78% 0.13 200)",
  ["--primary-foreground" as string]: "oklch(15% 0.02 250)",
  ["--accent" as string]: "oklch(24% 0.04 230)",
  ["--ring" as string]: "oklch(78% 0.13 200)",
};

export default function CockpitCopilot() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole={false}>
      {/* Registers the launch + human-in-the-loop + generative-UI tools. */}
      <CopilotActions />
      {/* Mission steering + prompt chips. */}
      <MissionContext />
      <Suggestions />
      <div
        style={CHAT_THEME}
        className="dark flex h-full min-h-0 flex-col overflow-hidden bg-transparent text-slate-200"
      >
        <CopilotChat
          className="glassbox-copilot-chat h-full min-h-0"
          welcomeScreen={MissionWelcome}
          input={INPUT_SLOTS}
          suggestionView={SUGGESTION_SLOTS}
          labels={{
            chatInputPlaceholder: "Launch a run, or ask anything...",
          }}
        />
      </div>
    </CopilotKitProvider>
  );
}
