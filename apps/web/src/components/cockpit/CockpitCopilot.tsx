"use client";

// The CopilotKit command bar for the Glassbox cockpit. Wraps the chat in the
// v2 provider, registers the mission-control tools, and renders an embedded
// CopilotChat themed to match the dark glass dock. The model (W&B Inference, a
// standard instruct model) decides when to call launchRun / launchClimb /
// launchLive and when to render the correctness curve / leaderboard as
// generative UI inside the thread.
//
// VERSION: @copilotkit/runtime 1.59.x mounts the v2 single-route endpoint via
// copilotRuntimeNextJSAppRouterEndpoint, so the client uses the matching v2
// React stack: CopilotKitProvider + CopilotChat + useFrontendTool +
// useConfigureSuggestions, with the v2 stylesheet.
//
// Imported by CockpitBoard via next/dynamic { ssr: false } so the runtime
// client and chat widget never run during server rendering.

import {
  CopilotKitProvider,
  CopilotChat,
  useAgentContext,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type { CSSProperties } from "react";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotActions } from "./CopilotActions";

const SYSTEM_INSTRUCTIONS = [
  "You are Glassbox mission control: the operator's copilot for a self-improving agent swarm that ports a BPE tokenizer to Rust and grades itself against a hard oracle (exact token-id match).",
  "To start a build, call the launch tools. Do not just describe what you would do, actually call the tool.",
  "Use launchClimb for the genuine self-improvement loop (the headline demo): asking to port the BPE tokenizer to Rust, to improve, to climb, or to run the loop should call launchClimb.",
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

// Static prompt chips shown before the first message. Matches the suggested
// starters in the cockpit brief.
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
          title: "Run the self-improvement loop",
          message: "Run the self-improvement loop",
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
      {/* Registers the launch + generative-UI tools against the provider. */}
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
          labels={{
            modalHeaderTitle: "mission control",
            welcomeMessageText:
              "Glassbox copilot online. Ask me to port the BPE tokenizer to Rust, run the self-improvement loop, or show the correctness curve.",
            chatInputPlaceholder: "launch a run, or ask to see the curve...",
          }}
        />
      </div>
    </CopilotKitProvider>
  );
}
