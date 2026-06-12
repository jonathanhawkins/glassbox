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
import { DeckCurve } from "./DeckCurveLazy";
import { SponsorStrip } from "./SponsorLogos";
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
  Takeaway,
  Title,
} from "./primitives";

export type Slide = {
  id: string;
  title: string;
  accent: AccentName;
  render: () => ReactNode;
};

const WEAVE_LINK = "https://wandb.ai/whitely-white-elk-llc/glassbox/weave";

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
      className={`flex flex-col gap-0.5 rounded-xl border ${a.border} bg-panel/70 px-4 py-3 backdrop-blur`}
    >
      <span className={`font-mono text-base font-semibold ${a.text}`}>
        {name}
      </span>
      <span className="font-mono text-xs tracking-wide text-ink-dim">
        {role}
      </span>
    </div>
  );
}

/** A thin connector arrow between pipeline stages. */
function Flow() {
  return <span className="font-mono text-lg text-ink-dim">{"->"}</span>;
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
        {lead && <span className="text-ink-dim">{"␣"}</span>}
        <span className="whitespace-pre">{body}</span>
      </div>
      <span className="font-mono text-xs tabular-nums text-ink-dim">{id}</span>
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
    <li className="flex items-start gap-3 text-lg leading-relaxed text-ink-mid">
      <span className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.dot}`} />
      <span>{children}</span>
    </li>
  );
}

/** A compact card for the three judging beats. */
function JudgeCard({
  n,
  title,
  body,
  accent = "cyan",
}: {
  n: string;
  title: string;
  body: ReactNode;
  accent?: AccentName;
}) {
  const a = ACCENTS[accent];
  return (
    <Panel accent={accent} className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg border ${a.border} ${a.bg} font-mono text-sm ${a.text}`}
        >
          {n}
        </span>
        <span className={`font-mono text-sm uppercase tracking-[0.16em] ${a.text}`}>
          {title}
        </span>
      </div>
      <p className="text-base leading-relaxed text-ink-mid">{body}</p>
    </Panel>
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
          <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-pass/40 bg-pass/10 px-3 py-1 font-mono text-sm text-pass">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pass opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-pass" />
            </span>
            live . WeaveHacks 4
          </div>

          <h1 className="text-[6.5rem] font-semibold leading-none tracking-tight text-ink">
            Glassbox
          </h1>

          <p className="mt-7 max-w-4xl text-balance text-2xl leading-snug text-ink">
            Agent swarms are black boxes. Glassbox is the glass cockpit that lets
            you watch a self-improving swarm build real code, graded live against
            ground truth.
          </p>

          <div className="mt-8 grid w-full gap-3 md:grid-cols-3">
            <JudgeCard
              n="1"
              title="watch it"
              accent="cyan"
              body="Beads move from planner to workers to validator on a live board."
            />
            <JudgeCard
              n="2"
              title="score it"
              accent="emerald"
              body="The validator builds real code and compares it to a hard oracle."
            />
            <JudgeCard
              n="3"
              title="improve it"
              accent="violet"
              body="The improver rewrites the planner skill, then the curve climbs."
            />
          </div>

          <SponsorStrip align="left" className="mt-10" />

          <p className="mt-8 font-mono text-sm tracking-wide text-ink-dim">
            press <span className="text-accent">{"->"}</span> to advance
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
        <Title>Orchestration today hides the answers that matter.</Title>
        <div className="mt-8 grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
          <Lede>
            You spin up a swarm and stare at scrolling logs. The hard questions
            stay buried: who did the work, did quality improve, and was it
            measured against truth?
          </Lede>

          {/* A visual nod: a grid of dim, unreadable panes. */}
          <Panel accent="rose" className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="space-y-1 rounded-md border border-line bg-canvas/40 p-2"
                >
                  {Array.from({ length: 4 }).map((__, j) => (
                    <div
                      key={j}
                      className="h-1 rounded-full bg-ink-faint/60"
                      style={{ width: `${40 + ((i * 7 + j * 11) % 55)}%` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-3 text-center font-mono text-xs tracking-wide text-fail/80">
              no signal . no ground truth . no idea if it is working
            </p>
          </Panel>
        </div>
        <Takeaway accent="rose">
          Glassbox turns the hidden orchestration loop into a visible, measured
          system you can inspect in three minutes.
        </Takeaway>
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
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.18em] text-ink-mid/80">
              the product
            </div>
            <p className="text-xl leading-relaxed text-ink-mid">
              <span className="text-ink-mid">Glassbox</span> is a general
              self-improvement harness. The demo shows the complete loop:
              decompose work, run workers, grade truth, rewrite the planner.
            </p>
          </Panel>
          <Panel accent="cyan" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.18em] text-accent/80">
              the target (just the proof)
            </div>
            <p className="text-xl leading-relaxed text-ink-mid">
              A tokenizer. Not the point, the proof. We picked it for{" "}
              <span className="text-accent">ground truth</span>: an exact,
              un-gameable token-ID diff a swarm cannot bluff.
            </p>
          </Panel>
        </div>
        <p className="mt-8 text-pretty text-xl leading-relaxed text-ink-mid">
          Glassbox is{" "}
          <span className="text-ink">not a tokenizer tool</span>. It is the
          orchestration cockpit and evaluator loop, pointed at a target small
          enough to finish and prove in a weekend, then{" "}
          <span className="text-accent-bright">at any repo you hand it</span> (more on
          that later).
        </p>
        <Takeaway accent="cyan">
          The tokenizer is the scoreboard. The product is the glass cockpit over
          a self-improving swarm.
        </Takeaway>
      </SlideShell>
    ),
  },

  // 4. What it builds + why it is gradeable (the normie-proof explainer + oracle)
  {
    id: "tokenizer-101",
    title: "What it builds",
    accent: "cyan",
    render: () => (
      <SlideShell accent="cyan">
        <Eyebrow accent="cyan">the target, and why</Eyebrow>
        <Title>A tokenizer, because the answer is exact.</Title>

        <Lede>
          Models never see letters, they see token IDs. There is exactly one right
          answer per sentence, so a nice demo cannot bluff the score.
        </Lede>

        <Panel accent="cyan" className="mt-6 p-6">
          <div className="mb-3 text-center font-mono text-xl text-ink">
            She said, &quot;It&apos;s a beautiful day, isn&apos;t it?&quot;
          </div>
          <div className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-accent/70">
            gpt2 byte-pair encoding {"->"}
          </div>
          <div className="flex flex-wrap items-start justify-center gap-2.5">
            {SAMPLE_TOKENS.map((tok, i) => (
              <TokenChip key={i} t={tok.t} id={tok.id} punct={tok.punct} />
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-ink-mid">
            The space rides with the word, <Mono accent="violet">&apos;t</Mono> and{" "}
            <Mono accent="violet">?&quot;</Mono> are their own tokens. One wrong ID
            fails the line.
          </p>
        </Panel>

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1.15fr] md:items-center">
          <div className="flex flex-wrap gap-8">
            <Stat value="217 / 217" label="corpus lines exact" accent="emerald" />
            <Stat value="100%" label="vs tiktoken gpt2" accent="emerald" />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {CATEGORIES.map(({ cap, label }) => (
              <span
                key={cap}
                className="flex items-center gap-2 rounded-lg border border-line bg-raised/40 px-2.5 py-1.5"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: CAP_COLORS[cap],
                    boxShadow: `0 0 8px ${CAP_COLORS[cap]}`,
                  }}
                />
                <span className="font-mono text-sm text-ink">{label}</span>
              </span>
            ))}
          </div>
        </div>

        <Takeaway accent="emerald">
          An exact token-ID diff against tiktoken, scored per category. An
          incomplete plan honestly fails the classes it skips, so the score comes
          from the built artifact, not the planner&apos;s say-so.
        </Takeaway>
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
        <Title>Planner, coordinator, four workers, validator, improver.</Title>

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
              <div className="mb-1 font-mono text-sm uppercase tracking-[0.18em] text-ink-mid">
                <Mono accent="violet">handoffs</Mono> + <Mono accent="cyan">Beads</Mono>
              </div>
              <p className="text-lg leading-relaxed text-ink-mid">
                The cockpit shows every handoff as an Agent Mail style thread.
                Work lives in Beads, the <Mono>br</Mono> dependency-aware issue
                graph.
              </p>
            </Panel>
            <Panel className="p-5">
              <div className="mb-1 font-mono text-sm uppercase tracking-[0.18em] text-ink-mid">
                dependency-aware
              </div>
              <p className="text-lg leading-relaxed text-ink-mid">
                The planner builds 8 beads with real edges. One foundational
                bead unblocks six parallel workers, then the harness bead closes
                it out.
              </p>
            </Panel>
          </div>
        </div>
        <Takeaway accent="violet">
          On the board, look for the dependency graph: once the foundation bead
          closes, parallel worker lanes light up together.
        </Takeaway>
      </SlideShell>
    ),
  },

  // 6. Weave grades it
  {
    id: "weave",
    title: "Weave traces it",
    accent: "amber",
    render: () => (
      <SlideShell accent="amber">
        <Eyebrow accent="amber">w&b weave</Eyebrow>
        <Title>Weave shows the run. The oracle supplies the truth.</Title>

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1fr] md:items-start">
          <ul className="flex flex-col gap-4">
            <Point accent="amber">
              <Mono accent="amber">@weave.op</Mono> on the planner, workers,
              validator, improver, and the run loop. Every run renders as one
              nested session.
            </Point>
            <Point accent="amber">
              The validator records exact-match accuracy, pass@1, wall time, and
              failing groups from the oracle.
            </Point>
            <Point accent="amber">
              The improver uses those Weave-traced results to rewrite the
              planner skill for the next version.
            </Point>
          </ul>

          <Panel accent="amber" className="p-6">
            <div className="mb-3 font-mono text-sm uppercase tracking-[0.18em] text-ink-mid">
              nested trace
            </div>
            <div className="space-y-1.5 font-mono text-base">
              {[
                { d: 0, t: "run_loop", c: "text-accent-bright" },
                { d: 1, t: "planner.decompose", c: "text-ink-mid" },
                { d: 1, t: "coordinator.route", c: "text-accent" },
                { d: 2, t: "worker.implement x4", c: "text-ink-mid" },
                { d: 1, t: "validator.oracle_diff", c: "text-pass" },
                { d: 2, t: "score: accuracy, pass@1", c: "text-pass" },
                { d: 1, t: "improver.rewrite_skill", c: "text-accent" },
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  style={{ paddingLeft: `${row.d * 1.4}rem` }}
                >
                  <span className="text-ink-dim">{row.d === 0 ? "+" : "|-"}</span>
                  <span className={row.c}>{row.t}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <p className="mt-7 text-pretty text-xl leading-relaxed text-ink-mid">
          With a hard oracle underneath, Weave tells us{" "}
          <span className="text-accent-bright">which sub-agent moved correctness</span>{" "}
          and whether a plan passed cleanly or thrashed.
        </p>
        <Takeaway accent="amber">
          Weave makes the agent loop inspectable. The oracle makes the score
          trustworthy.
        </Takeaway>
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
              The improver reads which categories failed in the validator&apos;s
              Weave-traced oracle result and rewrites{" "}
              <Mono accent="cyan">agents/planner/SKILL.md</Mono> to add the
              missing-category bead.
            </Lede>
            <ul className="flex flex-col gap-3">
              <Point accent="cyan">
                The skill materially grows{" "}
                <span className="text-accent">v1 to v7</span>, snapshotted in{" "}
                <Mono>agents/planner/history/</Mono>.
              </Point>
              <Point accent="cyan">
                Each version adds one category, so accuracy steps{" "}
                <span className="text-accent">+1/7</span> every time. Honest,
                not staged.
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
        <Takeaway accent="cyan">
          This is the self-improvement claim: the planner changes on disk, then
          the next run creates a better bead graph.
        </Takeaway>
      </SlideShell>
    ),
  },

  // 7b. It generalizes: bring your own repo
  {
    id: "byo",
    title: "Point it at any repo",
    accent: "amber",
    render: () => (
      <SlideShell accent="amber">
        <Eyebrow accent="amber">it generalizes</Eyebrow>
        <Title>Same swarm. Now point it at any repo.</Title>

        <Lede>
          The tokenizer proves the loop. To prove it is not a tokenizer tool, you
          hand the same swarm a real repo and a test command. It discovers what is
          broken, fixes it with the LLM, and grades itself against{" "}
          <span className="text-accent-bright">your</span> suite, with no deterministic
          safety net.
        </Lede>

        <div className="mt-9 grid gap-4 md:grid-cols-3">
          <Panel accent="amber" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-accent-bright/80">
              1 . discover
            </div>
            <p className="text-lg leading-relaxed text-ink-mid">
              Run the suite once. The failing test modules become the scoring
              groups, live.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill accent="amber">calc</Pill>
              <Pill accent="amber">textutil</Pill>
            </div>
          </Panel>
          <Panel accent="violet" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-ink-mid/80">
              2 . fix
            </div>
            <p className="text-lg leading-relaxed text-ink-mid">
              Workers author real edits with the LLM. An edit is kept only if it{" "}
              <span className="text-ink-mid">strictly raises the score</span>.
              No fallback, so a bead that does not help bounces.
            </p>
          </Panel>
          <Panel accent="emerald" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-pass/80">
              3 . green
            </div>
            <p className="text-lg leading-relaxed text-ink-mid">
              The real pytest pass-rate climbs. Workers edit a disposable sandbox,
              so the source repo is <span className="text-pass">never
              mutated</span>, and test files are read-only.
            </p>
          </Panel>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-10">
          <Stat value="0.50 -> 1.00" label="real pytest pass-rate" accent="emerald" />
          <Stat value="2 / 2" label="modules fixed by the LLM" accent="amber" />
          <Stat value="no fallback" label="the score is what it earned" accent="violet" />
        </div>

        <Takeaway accent="amber">
          Two targets, one swarm: a Rust tokenizer with an exact oracle, and any
          repo you hand it with its own test suite as the oracle.
        </Takeaway>
      </SlideShell>
    ),
  },

  // 8. The cockpit
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
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-accent/80">
              tldraw board
            </div>
            <p className="text-lg leading-relaxed text-ink-mid">
              8 agent lanes and capability-colored bead nodes animate backlog to
              worker to validator over SSE.
            </p>
          </Panel>
          <Panel accent="emerald" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-pass/80">
              command bar
            </div>
            <p className="text-lg leading-relaxed text-ink-mid">
              A CopilotKit chat with generative-UI charts rendered inside the
              thread. Launch the whole run by typing the goal.
            </p>
          </Panel>
          <Panel accent="violet" className="p-6">
            <div className="mb-2 font-mono text-sm uppercase tracking-[0.16em] text-ink-mid/80">
              live curve
            </div>
            <p className="text-lg leading-relaxed text-ink-mid">
              A recharts correctness curve climbing in real time, fed by the
              Redis leaderboard.
            </p>
          </Panel>
        </div>

        {/* The live "spot a gap, inject a bead" beat, folded in as a cockpit cue. */}
        <Panel accent="violet" className="mt-6 flex flex-wrap items-center justify-between gap-5 px-6 py-5">
          <p className="max-w-md text-pretty text-lg leading-relaxed text-ink-mid">
            Mid-run the swarm spots a missing capability and injects a real bead
            into the <Mono>br</Mono> graph live. The oracle accuracy jumps in front
            of you.
          </p>
          <div className="flex items-center gap-3">
            {[
              { v: "0.71", label: "gap", accent: "amber" as AccentName },
              { v: "0.86", label: "injected", accent: "violet" as AccentName },
              { v: "1.00", label: "covered", accent: "cyan" as AccentName },
            ].map((s, i, arr) => (
              <div key={s.label} className="flex items-center gap-3">
                <div className="text-center">
                  <div className={`text-3xl font-bold tabular-nums ${ACCENTS[s.accent].text}`}>
                    {s.v}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
                    {s.label}
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <span className="font-mono text-xl text-ink-dim">{"->"}</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
        <Takeaway accent="cyan">
          In the live demo, watch for four events: bead created, bead claimed,
          validation scored, planner rewritten.
        </Takeaway>
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

        <SponsorStrip
          label="powered by"
          align="left"
          className="mt-8 border-y border-line py-6"
        />

        <div className="mt-9 grid gap-5 md:grid-cols-3">
          <Panel accent="cyan" className="flex flex-col gap-3 p-6">
            <div className="font-mono text-2xl font-semibold text-accent">
              Weave
            </div>
            <p className="text-base leading-relaxed text-ink-mid">
              Tracing for the planner, workers, validator, improver, and LLM
              calls. The improver consumes the Weave-traced oracle gaps to
              rewrite the skill.
            </p>
          </Panel>
          <Panel accent="rose" className="flex flex-col gap-3 p-6">
            <div className="font-mono text-2xl font-semibold text-fail">
              Redis
            </div>
            <p className="text-base leading-relaxed text-ink-mid">
              The live bus, not just storage. A Stream (
              <Mono>glassbox:events</Mono>) fans every agent event to the tldraw
              board over SSE, a sorted set per task (
              <Mono>{"glassbox:planner_scores:{task}"}</Mono>) ranks the curve, and
              a bead-graph mirror hydrates the board on load.
            </p>
          </Panel>
          <Panel accent="emerald" className="flex flex-col gap-3 p-6">
            <div className="font-mono text-2xl font-semibold text-pass">
              CopilotKit
            </div>
            <p className="text-base leading-relaxed text-ink-mid">
              The command bar over AG-UI. Four frontend tools (launch, climb,
              live, propose) let the operator start a run by typing, a
              human-in-the-loop approval card gates the climb, and the curve and
              leaderboard render as generative UI inside the thread.
            </p>
          </Panel>
        </div>

        {/* The rest of the load-bearing stack, named so judges see every piece. */}
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Panel accent="violet" className="p-5">
            <div className="font-mono text-lg font-semibold text-ink-mid">
              Agent Mail
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-mid">
              Agent-to-agent messages and advisory file leases. Every handoff
              shows up as a thread in the cockpit drawer.
            </p>
          </Panel>
          <Panel accent="violet" className="p-5">
            <div className="font-mono text-lg font-semibold text-ink-mid">
              Beads (br)
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-mid">
              The dependency-aware issue graph. The planner writes it, the
              coordinator routes <Mono>br ready</Mono> beads to workers.
            </p>
          </Panel>
          <Panel accent="amber" className="p-5">
            <div className="font-mono text-lg font-semibold text-accent-bright">
              tldraw
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-mid">
              The programmatic canvas: agent lanes and capability-colored beads,
              animated entirely from the Redis event stream.
            </p>
          </Panel>
        </div>

        <p className="mt-7 text-pretty text-lg text-ink-mid">
          Swarm on W&B Inference (<Mono>openai/gpt-oss-120b</Mono>), chat on{" "}
          <Mono>meta-llama/Llama-3.3-70B-Instruct</Mono>. Weave auto-traces both.
        </p>
        <Takeaway accent="amber">
          Each sponsor is in the critical path: observe, stream, launch, and
          explain the run.
        </Takeaway>
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
              Ours: the swarm loop, task/evaluator abstraction, oracle harness,
              cockpit, and self-improvement loop.
            </Point>
            <Point accent="emerald">
              Patina (a larger Godot-to-Rust port) is referenced as context only.
              No Patina code reused.
            </Point>
          </ul>

          <Panel className="p-6">
            <div className="mb-3 font-mono text-sm uppercase tracking-[0.18em] text-ink-mid">
              third-party deps (not ours)
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Pill accent="violet">Beads (br)</Pill>
              <Pill accent="violet">Agent Mail style handoffs</Pill>
              <Pill accent="amber">tldraw</Pill>
              <Pill accent="emerald">CopilotKit</Pill>
              <Pill accent="cyan">recharts</Pill>
              <Pill accent="emerald">tiktoken</Pill>
            </div>
          </Panel>
        </div>
        <Takeaway accent="emerald">
          The borrowed pieces are named. The agent loop, evaluator, cockpit, and
          planner rewrite path are the fresh build.
        </Takeaway>
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
          <h2 className="text-balance text-6xl font-semibold leading-[1.05] tracking-tight text-ink">
            Orchestration you can see,{" "}
            <span className="text-accent">graded against truth</span>, that{" "}
            <span className="text-accent">improves itself.</span>
          </h2>

          <div className="relative z-40 mt-12 grid w-full gap-4 md:grid-cols-2">
            <Link
              href="/hackathon"
              className="group flex items-center justify-between rounded-2xl border border-accent/40 bg-accent/10 px-6 py-5 transition hover:bg-accent/20"
            >
              <div>
                <div className="font-mono text-sm uppercase tracking-[0.18em] text-accent/80">
                  live demo
                </div>
                <div className="mt-1 text-2xl font-semibold text-ink">
                  Open the cockpit
                </div>
              </div>
              <span className="font-mono text-3xl text-accent transition group-hover:translate-x-1">
                {"->"}
              </span>
            </Link>

            <a
              href={WEAVE_LINK}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between rounded-2xl border border-line bg-white/[0.04] px-6 py-5 transition hover:bg-raised"
            >
              <div>
                <div className="font-mono text-sm uppercase tracking-[0.18em] text-ink-mid">
                  w&b weave project
                </div>
                <div className="mt-1 break-all font-mono text-base text-ink-mid">
                  wandb.ai/whitely-white-elk-llc/glassbox/weave
                </div>
              </div>
              <span className="ml-4 font-mono text-3xl text-ink-mid transition group-hover:translate-x-1">
                {"->"}
              </span>
            </a>
          </div>

          <SponsorStrip align="left" className="mt-12" />

          <p className="mt-8 font-mono text-sm tracking-wide text-ink-dim">
            handoff to the live board at <span className="text-accent">/</span>
          </p>
        </div>
      </SlideShell>
    ),
  },
];
