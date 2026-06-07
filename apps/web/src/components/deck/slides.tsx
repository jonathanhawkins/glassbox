"use client";

// The Glassbox pitch deck content (WeaveHacks 4, 3-minute live pitch).
//
// Each slide is a typed { id, title, accent, render } record. `title` feeds the
// slide counter / outline; `render` returns the slide body inside a SlideShell.
// All copy is grounded in docs/DEMO.md, docs/SUBMISSION.md, README.md, and
// contract/CAPABILITIES.md, and every number here is verified, not invented.
// No em dashes anywhere (periods, commas, parentheses only).

import type { ReactNode } from "react";
import Link from "next/link";
import { CAP_COLORS } from "@/lib/cockpit/types";
import { DeckCurve } from "./DeckCurve";
import {
  ACCENTS,
  type AccentName,
  Eyebrow,
  Lede,
  Mono,
  Panel,
  Pill,
  SlideShell,
  Stat,
  Title,
} from "./primitives";

export type Slide = {
  id: string;
  title: string;
  accent: AccentName;
  render: () => ReactNode;
};

const WEAVE_LINK = "https://wandb.ai/white-elk-llc/glassbox/weave";

// The seven scoring categories (contract/CAPABILITIES.md), in plan order, with
// the cockpit's per-capability neon palette so the deck matches the board.
const CATEGORIES: { cap: keyof typeof CAP_COLORS; label: string }[] = [
  { cap: "ascii", label: "ascii" },
  { cap: "punctuation", label: "punctuation" },
  { cap: "numbers", label: "numbers" },
  { cap: "code", label: "code" },
  { cap: "unicode", label: "unicode" },
  { cap: "emoji", label: "emoji" },
  { cap: "whitespace", label: "whitespace" },
];

// --- small shared building blocks specific to these slides -----------------

/** A node in the swarm topology / pipeline diagrams. */
function AgentNode({
  name,
  role,
  accent = "cyan",
}: {
  name: string;
  role: string;
  accent?: AccentName;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-xl border ${a.border} bg-slate-950/70 px-4 py-3 backdrop-blur`}
    >
      <span className={`font-mono text-base font-semibold ${a.text}`}>
        {name}
      </span>
      <span className="font-mono text-xs tracking-wide text-slate-500">
        {role}
      </span>
    </div>
  );
}

/** A thin connector arrow between pipeline stages. */
function Flow() {
  return <span className="font-mono text-lg text-slate-600">{"->"}</span>;
}

// The real gpt2 tokenization of one corpus-style sentence, used to demystify
// what the swarm is actually building. Token pieces and IDs are exact (decoded
// from harness/data/gpt2.tiktoken), not illustrative.
const SAMPLE_TOKENS: { t: string; id: number; punct?: boolean }[] = [
  { t: "She", id: 3347 },
  { t: " said", id: 531 },
  { t: ",", id: 11, punct: true },
  { t: ' "', id: 366, punct: true },
  { t: "It", id: 1026 },
  { t: "'s", id: 338, punct: true },
  { t: " a", id: 257 },
  { t: " beautiful", id: 4950 },
  { t: " day", id: 1110 },
  { t: ",", id: 11, punct: true },
  { t: " isn", id: 2125 },
  { t: "'t", id: 470, punct: true },
  { t: " it", id: 340 },
  { t: '?"', id: 1701, punct: true },
];

/** One token: the exact text piece on top, its integer ID below. */
function TokenChip({
  t,
  id,
  punct = false,
}: {
  t: string;
  id: number;
  punct?: boolean;
}) {
  const a = ACCENTS[punct ? "violet" : "cyan"];
  // Render a leading space as a visible, dimmed marker so the audience sees
  // that the space is part of the token (the surprising, memorable detail).
  const lead = t.startsWith(" ");
  const body = lead ? t.slice(1) : t;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`rounded-lg border ${a.border} ${a.bg} px-2.5 py-1.5 font-mono text-lg ${a.text}`}
      >
        {lead && <span className="text-slate-600">{"␣"}</span>}
        <span className="whitespace-pre">{body}</span>
      </div>
      <span className="font-mono text-xs tabular-nums text-slate-500">{id}</span>
    </div>
  );
}

/** A labeled row in a feature list with an accent tick. */
function Point({
  accent = "cyan",
  children,
}: {
  accent?: AccentName;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <li className="flex items-start gap-3 text-lg leading-relaxed text-slate-300">
      <span className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.dot}`} />
      <span>{children}</span>
    </li>
  );
}

// --- slides ----------------------------------------------------------------

export const SLIDES: Slide[] = [
  // 1. Title
  {
    id: "title",
    title: "Glassbox",
    accent: "cyan",
    render: () => (
      <SlideShell accent="cyan">
        <div className="flex flex-col items-start">
          <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-mono text-sm text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            live . WeaveHacks 4
          </div>

          <h1 className="text-[7rem] font-semibold leading-none tracking-tight text-slate-50">
            Glassbox
          </h1>

          <p className="mt-8 max-w-4xl text-balance text-3xl leading-snug text-slate-200">
            Agent swarms are black boxes. Glassbox is the glass cockpit that lets
            you watch a self-improving swarm build real code, graded live against
            ground truth.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-2.5">
            <Pill accent="violet">Agent Mail</Pill>
            <Pill accent="violet">Beads</Pill>
            <Pill accent="cyan">Weave</Pill>
            <Pill accent="rose">Redis</Pill>
            <Pill accent="emerald">CopilotKit</Pill>
            <Pill accent="amber">tldraw</Pill>
          </div>

          <p className="mt-10 font-mono text-sm tracking-wide text-slate-500">
            press <span className="text-cyan-300">{"->"}</span> to advance
          </p>
        </div>
      </SlideShell>
    ),
  },

  // 2. The problem
  {
    id: "problem",
    title: "The problem",
    accent: "rose",
    render: () => (
      <SlideShell accent="rose">
        <Eyebrow accent="rose">the problem</Eyebrow>
        <Title>Orchestration today is a wall of tmux panes.</Title>
        <div className="mt-8 grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
          <Lede>
            You spin up a swarm and stare at scrolling logs. Nobody, not even the
            operator, can see whether the swarm is actually adding value, or just
            burning tokens.
          </Lede>

          {/* A visual nod: a grid of dim, unreadable panes. */}
          <Panel accent="rose" className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="space-y-1 rounded-md border border-slate-800/80 bg-black/40 p-2"
                >
                  {Array.from({ length: 4 }).map((__, j) => (
                    <div
                      key={j}
                      className="h-1 rounded-full bg-slate-700/60"
                      style={{ width: `${40 + ((i * 7 + j * 11) % 55)}%` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-3 text-center font-mono text-xs tracking-wide text-rose-300/80">
              no signal . no ground truth . no idea if it is working
            </p>
          </Panel>
        </div>
      </SlideShell>
    ),
  },

  // 3. The idea
  {
    id: "idea",
    title: "The idea",
    accent: "cyan",
    render: () => (
      <SlideShell accent="cyan">
        <Eyebrow accent="cyan">the idea</Eyebrow>
        <Title>
          Watch a self-improving swarm build real code, graded live against ground
          truth.
        </Title>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Panel accent="violet" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.18em] text-violet-300/80">
              the product
            </div>
            <p className="text-xl leading-relaxed text-slate-300">
              <span className="text-violet-300">Glassbox</span> is a general
              self-improvement harness. You point it at any agent swarm and watch
              it get better at the job, live.
            </p>
          </Panel>
          <Panel accent="cyan" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.18em] text-cyan-300/80">
              the target (just the proof)
            </div>
            <p className="text-xl leading-relaxed text-slate-300">
              A tokenizer. Not the point, the proof. We picked it for{" "}
              <span className="text-cyan-300">ground truth</span>: an exact,
              un-gameable token-ID diff a swarm cannot bluff.
            </p>
          </Panel>
        </div>
        <p className="mt-8 text-pretty text-xl leading-relaxed text-slate-300">
          Glassbox is{" "}
          <span className="text-slate-100">not a tokenizer tool</span>. It is the
          machine we have run for months, pointed at a target small enough to
          finish and prove in a weekend.
        </p>
      </SlideShell>
    ),
  },

  // 4. What a tokenizer actually does (the normie-proof explainer)
  {
    id: "tokenizer-101",
    title: "What it builds",
    accent: "cyan",
    render: () => (
      <SlideShell accent="cyan">
        <Eyebrow accent="cyan">in plain english</Eyebrow>
        <Title>A tokenizer chops text into the numbers an AI reads.</Title>

        <Lede>
          Models never see letters. They see token IDs. The tokenizer is the
          translator, and there is exactly one right answer for every sentence.
        </Lede>

        <Panel accent="cyan" className="mt-9 p-7">
          <div className="mb-5 text-center font-mono text-2xl text-slate-100">
            She said, &quot;It&apos;s a beautiful day, isn&apos;t it?&quot;
          </div>

          <div className="mb-2 flex justify-center">
            <span className="font-mono text-2xl text-slate-600">{"|"}</span>
          </div>
          <div className="mb-5 text-center font-mono text-xs uppercase tracking-[0.2em] text-cyan-300/70">
            gpt2 byte-pair encoding
          </div>

          <div className="flex flex-wrap items-start justify-center gap-2.5">
            {SAMPLE_TOKENS.map((tok, i) => (
              <TokenChip key={i} t={tok.t} id={tok.id} punct={tok.punct} />
            ))}
          </div>
        </Panel>

        <p className="mt-7 text-pretty text-lg text-slate-400">
          Notice the pieces are weird: the space rides with the word,{" "}
          <Mono accent="violet">&apos;t</Mono> and{" "}
          <Mono accent="violet">?&quot;</Mono> are their own tokens. Get a single
          ID wrong and the whole line fails. That is what makes it the perfect,
          un-gameable scorecard.
        </p>
      </SlideShell>
    ),
  },

  // 5. The swarm + coordination
  {
    id: "swarm",
    title: "The swarm",
    accent: "violet",
    render: () => (
      <SlideShell accent="violet">
        <Eyebrow accent="violet">the swarm + coordination</Eyebrow>
        <Title>Eight agents, coordinating in the open.</Title>

        <div className="mt-9 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <AgentNode name="planner" role="decompose goal" accent="violet" />
            <Flow />
            <AgentNode name="coordinator" role="route ready beads" accent="cyan" />
            <Flow />
            <div className="grid grid-cols-2 gap-2">
              <AgentNode name="worker 1" role="implement" accent="amber" />
              <AgentNode name="worker 2" role="implement" accent="amber" />
              <AgentNode name="worker 3" role="implement" accent="amber" />
              <AgentNode name="worker 4" role="implement" accent="amber" />
            </div>
            <Flow />
            <AgentNode name="validator" role="grade vs oracle" accent="emerald" />
            <Flow />
            <AgentNode name="improver" role="close the gaps" accent="rose" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel className="p-5">
              <div className="mb-1 font-mono text-sm uppercase tracking-[0.18em] text-slate-400">
                <Mono accent="violet">Agent Mail</Mono> + <Mono accent="cyan">Beads</Mono>
              </div>
              <p className="text-lg leading-relaxed text-slate-300">
                Agents message and lease files over Agent Mail. Work lives in
                Beads, the <Mono>br</Mono> dependency-aware issue graph.
              </p>
            </Panel>
            <Panel className="p-5">
              <div className="mb-1 font-mono text-sm uppercase tracking-[0.18em] text-slate-400">
                dependency-aware
              </div>
              <p className="text-lg leading-relaxed text-slate-300">
                The planner builds 8 beads with real edges. One foundational
                bead unblocks six parallel workers, then the harness bead closes
                it out.
              </p>
            </Panel>
          </div>
        </div>
      </SlideShell>
    ),
  },

  // 5. Ground truth
  {
    id: "ground-truth",
    title: "Ground truth",
    accent: "emerald",
    render: () => (
      <SlideShell accent="emerald">
        <Eyebrow accent="emerald">ground truth</Eyebrow>
        <Title>Why a tokenizer: the answer is exact.</Title>

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1.05fr] md:items-start">
          <div className="flex flex-col gap-6">
            <Lede>
              The oracle is an exact token-ID diff against{" "}
              <Mono accent="emerald">tiktoken gpt2</Mono>. You cannot bluff it. The
              Rust port reproduces it{" "}
              <span className="text-emerald-300">byte for byte</span>, using
              fancy-regex (the same engine tiktoken uses) over the real gpt2
              merge ranks.
            </Lede>
            <div className="flex flex-wrap gap-10">
              <Stat value="217 / 217" label="corpus lines exact" accent="emerald" />
              <Stat value="100%" label="match vs tiktoken" accent="emerald" />
              <Stat value="11" label="rust tests pass" accent="emerald" />
            </div>
          </div>

          {/* The 7 scoring categories, colored to the board palette. */}
          <Panel accent="emerald" className="p-6">
            <div className="mb-4 font-mono text-sm uppercase tracking-[0.18em] text-slate-400">
              7 input categories, scored independently
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {CATEGORIES.map(({ cap, label }) => (
                <div
                  key={cap}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: CAP_COLORS[cap],
                      boxShadow: `0 0 8px ${CAP_COLORS[cap]}`,
                    }}
                  />
                  <span className="font-mono text-base text-slate-200">
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-base leading-relaxed text-slate-400">
              An incomplete plan genuinely fails the classes it does not cover, so
              the oracle returns an honest intermediate accuracy. Nothing is
              staged.
            </p>
          </Panel>
        </div>
      </SlideShell>
    ),
  },

  // 6. Weave grades it
  {
    id: "weave",
    title: "Weave grades it",
    accent: "amber",
    render: () => (
      <SlideShell accent="amber">
        <Eyebrow accent="amber">w&b weave</Eyebrow>
        <Title>Weave is not just logging. It grades.</Title>

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1fr] md:items-start">
          <ul className="flex flex-col gap-4">
            <Point accent="amber">
              <Mono accent="amber">@weave.op</Mono> on the planner, workers,
              validator, improver, and the run loop. Every run renders as one
              nested session.
            </Point>
            <Point accent="amber">
              A Weave <span className="text-amber-300">Evaluation</span> scored by
              the oracle (exact token-ID match, pass@1).
            </Point>
            <Point accent="amber">
              The W&B MCP server is wired in for inspecting runs, traces, and
              evals.
            </Point>
          </ul>

          <Panel accent="amber" className="p-6">
            <div className="mb-3 font-mono text-sm uppercase tracking-[0.18em] text-slate-400">
              nested trace
            </div>
            <div className="space-y-1.5 font-mono text-base">
              {[
                { d: 0, t: "run_loop", c: "text-amber-300" },
                { d: 1, t: "planner.decompose", c: "text-violet-300" },
                { d: 1, t: "coordinator.route", c: "text-cyan-300" },
                { d: 2, t: "worker.implement x4", c: "text-slate-300" },
                { d: 1, t: "validator.oracle_diff", c: "text-emerald-300" },
                { d: 2, t: "Evaluation: accuracy", c: "text-emerald-300" },
                { d: 1, t: "improver.rewrite_skill", c: "text-rose-300" },
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  style={{ paddingLeft: `${row.d * 1.4}rem` }}
                >
                  <span className="text-slate-600">{row.d === 0 ? "+" : "|-"}</span>
                  <span className={row.c}>{row.t}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <p className="mt-7 text-pretty text-xl leading-relaxed text-slate-300">
          With a hard oracle underneath, Weave tells us{" "}
          <span className="text-amber-300">which sub-agent moved correctness</span>{" "}
          and whether a plan passed cleanly or thrashed.
        </p>
      </SlideShell>
    ),
  },

  // 7. Self-improvement (centerpiece, live curve)
  {
    id: "self-improvement",
    title: "Self-improvement",
    accent: "cyan",
    render: () => (
      <SlideShell accent="cyan">
        <Eyebrow accent="cyan">the centerpiece</Eyebrow>
        <Title>The planner rewrites its own skill.</Title>

        <div className="mt-7 grid gap-7 md:grid-cols-[1fr_1.1fr] md:items-stretch">
          <div className="flex flex-col gap-5">
            <Lede>
              The improver reads which categories failed in the Weave eval and
              rewrites <Mono accent="cyan">agents/planner/SKILL.md</Mono> to add
              the missing-category bead. The LLM authors a dated rationale citing
              the prior accuracy.
            </Lede>
            <ul className="flex flex-col gap-3">
              <Point accent="cyan">
                The skill materially grows{" "}
                <span className="text-cyan-300">v1 to v7</span>, snapshotted in{" "}
                <Mono>agents/planner/history/</Mono>.
              </Point>
              <Point accent="cyan">
                Each version adds one category, so accuracy steps{" "}
                <span className="text-cyan-300">+1/7</span> every time. Honest, not
                hard-coded.
              </Point>
            </ul>
            <div className="flex flex-wrap gap-8">
              <Stat value="0.14" label="planner v1" accent="violet" />
              <Stat value="1.00" label="planner v7" accent="cyan" />
            </div>
          </div>

          {/* Live curve: GET /api/leaderboard, falls back to v1..v7. */}
          <Panel accent="cyan" className="flex min-h-[26rem] flex-col p-6">
            <DeckCurve />
          </Panel>
        </div>
      </SlideShell>
    ),
  },

  // 8. Spot a gap, inject a bead
  {
    id: "inject",
    title: "Spot a gap, inject a bead",
    accent: "violet",
    render: () => (
      <SlideShell accent="violet">
        <Eyebrow accent="violet">live, on the board</Eyebrow>
        <Title>Spot a gap, inject a bead, watch it jump.</Title>

        <Lede>
          Mid-run the swarm detects a missing capability, injects a bead into the
          graph live, and the oracle accuracy climbs in front of you.
        </Lede>

        <div className="mt-10 flex items-center justify-center gap-6">
          {[
            { v: "0.71", label: "gap detected", accent: "amber" as AccentName },
            { v: "0.86", label: "bead injected", accent: "violet" as AccentName },
            { v: "1.00", label: "covered", accent: "cyan" as AccentName },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center gap-6">
              <Panel accent={step.accent} className="px-8 py-6 text-center">
                <div
                  className={`text-5xl font-bold tabular-nums ${ACCENTS[step.accent].text}`}
                >
                  {step.v}
                </div>
                <div className="mt-2 font-mono text-sm uppercase tracking-[0.16em] text-slate-500">
                  {step.label}
                </div>
              </Panel>
              {i < arr.length - 1 && (
                <span className="font-mono text-3xl text-slate-600">{"->"}</span>
              )}
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-lg text-slate-400">
          Not a slide animation. A real bead in the <Mono>br</Mono> graph, scored
          by the same oracle.
        </p>
      </SlideShell>
    ),
  },

  // 9. The cockpit
  {
    id: "cockpit",
    title: "The cockpit",
    accent: "cyan",
    render: () => (
      <SlideShell accent="cyan">
        <Eyebrow accent="cyan">the cockpit</Eyebrow>
        <Title>One pane of glass over the whole swarm.</Title>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <Panel accent="cyan" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-cyan-300/80">
              tldraw board
            </div>
            <p className="text-lg leading-relaxed text-slate-300">
              8 agent lanes and capability-colored bead nodes animate backlog to
              worker to validator over SSE.
            </p>
          </Panel>
          <Panel accent="emerald" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-emerald-300/80">
              command bar
            </div>
            <p className="text-lg leading-relaxed text-slate-300">
              A CopilotKit chat with generative-UI charts rendered inside the
              thread. Launch the whole run by typing the goal.
            </p>
          </Panel>
          <Panel accent="violet" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-violet-300/80">
              live curve
            </div>
            <p className="text-lg leading-relaxed text-slate-300">
              A recharts correctness curve climbing in real time, fed by the
              Redis leaderboard.
            </p>
          </Panel>
        </div>

        <Panel className="mt-6 px-6 py-5">
          <p className="text-pretty text-xl leading-relaxed text-slate-300">
            Type{" "}
            <Mono accent="cyan">port the BPE tokenizer to Rust</Mono> into chat.
            The planner decomposes, beads appear on the chain, worker lanes light
            up amber, a bead travels to the validator, the curve moves.
          </p>
        </Panel>
      </SlideShell>
    ),
  },

  // 10. Sponsors
  {
    id: "sponsors",
    title: "Sponsors",
    accent: "amber",
    render: () => (
      <SlideShell accent="amber">
        <Eyebrow accent="amber">sponsors, all load-bearing</Eyebrow>
        <Title>None of these are bolted on.</Title>

        <div className="mt-9 grid gap-5 md:grid-cols-3">
          <Panel accent="cyan" className="flex flex-col gap-3 p-6">
            <div className="font-mono text-2xl font-semibold text-cyan-300">
              Weave
            </div>
            <p className="text-base leading-relaxed text-slate-300">
              Tracing, the Evaluation, and the self-improvement backbone. Plus the
              W&B MCP server. The improver consumes Weave-graded gaps to rewrite
              the skill.
            </p>
          </Panel>
          <Panel accent="rose" className="flex flex-col gap-3 p-6">
            <div className="font-mono text-2xl font-semibold text-rose-300">
              Redis
            </div>
            <p className="text-base leading-relaxed text-slate-300">
              The event stream (<Mono>glassbox:events</Mono>), the per-task
              leaderboard sorted set (<Mono>{"glassbox:planner_scores:{task}"}</Mono>),
              and the bead-graph mirror for board hydration.
            </p>
          </Panel>
          <Panel accent="emerald" className="flex flex-col gap-3 p-6">
            <div className="font-mono text-2xl font-semibold text-emerald-300">
              CopilotKit
            </div>
            <p className="text-base leading-relaxed text-slate-300">
              The chat command bar and generative UI over AG-UI. Surfaces the
              curve and leaderboard as React components inside the thread.
            </p>
          </Panel>
        </div>

        <p className="mt-7 text-pretty text-lg text-slate-400">
          Swarm on W&B Inference (<Mono>openai/gpt-oss-120b</Mono>), chat on{" "}
          <Mono>meta-llama/Llama-3.3-70B-Instruct</Mono>. Weave auto-traces both.
        </p>
      </SlideShell>
    ),
  },

  // 11. Built this weekend
  {
    id: "built",
    title: "Built this weekend",
    accent: "emerald",
    render: () => (
      <SlideShell accent="emerald">
        <Eyebrow accent="emerald">eligibility</Eyebrow>
        <Title>Built fresh this weekend.</Title>

        <div className="mt-8 grid gap-8 md:grid-cols-2 md:items-start">
          <ul className="flex flex-col gap-4">
            <Point accent="emerald">
              Brand new repo, committed every phase.
            </Point>
            <Point accent="emerald">
              Ours: the planner loop, the oracle harness, the cockpit, and the
              self-improvement loop.
            </Point>
            <Point accent="emerald">
              Patina (a larger Godot-to-Rust port) is referenced as context only.
              No Patina code reused.
            </Point>
          </ul>

          <Panel className="p-6">
            <div className="mb-3 font-mono text-sm uppercase tracking-[0.18em] text-slate-400">
              third-party deps (not ours)
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Pill accent="violet">Beads (br)</Pill>
              <Pill accent="violet">Agent Mail</Pill>
              <Pill accent="amber">tldraw</Pill>
              <Pill accent="emerald">CopilotKit</Pill>
              <Pill accent="cyan">recharts</Pill>
              <Pill accent="emerald">tiktoken</Pill>
            </div>
          </Panel>
        </div>
      </SlideShell>
    ),
  },

  // 12. Close
  {
    id: "close",
    title: "Close",
    accent: "cyan",
    render: () => (
      <SlideShell accent="cyan">
        <div className="flex flex-col items-start">
          <Eyebrow accent="cyan">glassbox</Eyebrow>
          <h2 className="text-balance text-6xl font-semibold leading-[1.05] tracking-tight text-slate-50">
            Orchestration you can see,{" "}
            <span className="text-cyan-300">graded against truth</span>, that{" "}
            <span className="text-violet-300">improves itself.</span>
          </h2>

          <div className="relative z-40 mt-12 grid w-full gap-4 md:grid-cols-2">
            <Link
              href="/"
              className="group flex items-center justify-between rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-6 py-5 transition hover:bg-cyan-500/20"
            >
              <div>
                <div className="font-mono text-sm uppercase tracking-[0.18em] text-cyan-300/80">
                  live demo
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-50">
                  Open the cockpit
                </div>
              </div>
              <span className="font-mono text-3xl text-cyan-300 transition group-hover:translate-x-1">
                {"->"}
              </span>
            </Link>

            <a
              href={WEAVE_LINK}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between rounded-2xl border border-amber-500/40 bg-amber-500/10 px-6 py-5 transition hover:bg-amber-500/20"
            >
              <div>
                <div className="font-mono text-sm uppercase tracking-[0.18em] text-amber-300/80">
                  w&b weave project
                </div>
                <div className="mt-1 break-all font-mono text-base text-slate-200">
                  wandb.ai/white-elk-llc/glassbox/weave
                </div>
              </div>
              <span className="ml-4 font-mono text-3xl text-amber-300 transition group-hover:translate-x-1">
                {"->"}
              </span>
            </a>
          </div>

          <p className="mt-10 font-mono text-sm tracking-wide text-slate-500">
            handoff to the live board at <span className="text-cyan-300">/</span>
          </p>
        </div>
      </SlideShell>
    ),
  },
];
