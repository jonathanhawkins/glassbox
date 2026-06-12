// The Glassbox marketing video, as code. Six scenes, 64 seconds: what the project
// actually became (a swarm agent coordinator), the five roles, per-role models and
// effort, the eight loop shapes with detected stop conditions, the living board, and
// the close. Every animation is useCurrentFrame + interpolate/spring (no CSS
// animations, per Remotion rules) and every style is inline (no Tailwind) so the
// same composition renders in the in-app <Player> AND through the Remotion CLI.

import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { MONO, SANS, T } from "./theme";

// --- timing (frames @ 30fps) -----------------------------------------------------
const OPEN_END = 180;
const ROLES_END = 560;
const MODELS_END = 880;
const LOOPS_END = 1400;
const BOARD_END = 1760;
const CLOSE_END = 1920;

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// --- tiny helpers -----------------------------------------------------------------
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function useRise(delay: number, dist = 28) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return {
    opacity: s,
    transform: `translateY(${interpolate(s, [0, 1], [dist, 0])}px)`,
  };
}

/** Fade the whole scene in over its first 12 frames and out over its last 12. */
function SceneShell({
  duration,
  children,
}: {
  duration: number;
  children: React.ReactNode;
}) {
  const frame = useCurrentFrame();
  const opacity =
    interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: EASE }) *
    interpolate(frame, [duration - 12, duration], [1, 0], { ...clamp, easing: EASE });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

/** The cockpit's faint dot grid, drifting very slowly so the canvas feels alive. */
function DotGrid() {
  const frame = useCurrentFrame();
  const shift = (frame * 0.08) % 48;
  return (
    <AbsoluteFill style={{ backgroundColor: T.canvas, overflow: "hidden" }}>
      <svg width="100%" height="100%">
        <defs>
          <pattern
            id="dots"
            x={shift}
            y={shift}
            width="48"
            height="48"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1.5" cy="1.5" r="1.5" fill={T.raised} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>
    </AbsoluteFill>
  );
}

function Kicker({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 26,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        color: T.inkDim,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// --- scene 1: open ------------------------------------------------------------------
function Open() {
  const frame = useCurrentFrame();
  const a = useRise(8);
  const b = useRise(26);
  const c = useRise(46);
  const underline = interpolate(frame, [20, 60], [0, 360], { ...clamp, easing: EASE });
  return (
    <SceneShell duration={OPEN_END}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              ...a,
              fontFamily: SANS,
              fontSize: 148,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: T.ink,
            }}
          >
            GLASSBOX
          </div>
          <div style={{ height: 4, width: underline, background: T.accent, margin: "10px auto 26px" }} />
          <div
            style={{
              ...b,
              fontFamily: MONO,
              fontSize: 40,
              color: T.accent,
              letterSpacing: "0.04em",
            }}
          >
            the swarm agent coordinator
          </div>
          <div
            style={{
              ...c,
              marginTop: 26,
              fontFamily: MONO,
              fontSize: 26,
              color: T.inkDim,
            }}
          >
            spawn a real swarm. watch it work. it knows when to stop.
          </div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
}

// --- scene 2: the five roles ---------------------------------------------------------
const ROLES = [
  { name: "planner", line: "decompose the goal", x: 130 },
  { name: "coordinator", line: "route the work", x: 470 },
  { name: "worker-1", line: "implement", x: 810, dy: -120 },
  { name: "worker-2", line: "implement", x: 810, dy: 120 },
  { name: "validator", line: "verify each wave", x: 1150 },
  { name: "improver", line: "close the gaps", x: 1490 },
];

function RoleCard({
  name,
  line,
  delay,
  litAt,
}: {
  name: string;
  line: string;
  delay: number;
  litAt: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const lit = interpolate(frame, [litAt, litAt + 14], [0, 1], { ...clamp, easing: EASE });
  return (
    <div
      style={{
        opacity: s,
        transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})`,
        width: 300,
        borderRadius: 14,
        border: `1.5px solid ${lit > 0.5 ? T.accentLine : T.line}`,
        background: T.panel,
        padding: "22px 24px",
        boxShadow: lit > 0.5 ? `0 0 ${24 * lit}px rgba(255,106,26,${0.22 * lit})` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: lit > 0.5 ? T.accent : T.inkFaint,
          }}
        />
        <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: T.ink }}>{name}</div>
      </div>
      <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 21, color: T.inkMid }}>{line}</div>
      <div
        style={{
          marginTop: 12,
          fontFamily: MONO,
          fontSize: 17,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: lit > 0.5 ? T.accent : T.inkDim,
        }}
      >
        {lit > 0.5 ? "working" : "idle"}
      </div>
    </div>
  );
}

function Roles() {
  const head = useRise(4);
  const frame = useCurrentFrame();
  const wire = interpolate(frame, [16, 70], [0, 1], { ...clamp, easing: EASE });
  return (
    <SceneShell duration={ROLES_END - OPEN_END}>
      <AbsoluteFill style={{ padding: "90px 110px" }}>
        <Kicker style={head}>five roles · one board</Kicker>
        <div style={{ ...head, marginTop: 18, fontFamily: SANS, fontSize: 64, fontWeight: 750, color: T.ink }}>
          A real swarm, not a diagram.
        </div>
        <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 25, color: T.inkDim, ...head }}>
          every node is a live Claude Code session in tmux
        </div>
        {/* spine wire */}
        <svg
          width="1700"
          height="420"
          style={{ position: "absolute", left: 110, top: 460, opacity: 0.8 }}
        >
          <path
            d={`M 300 210 H ${300 + 1360 * wire}`}
            stroke={T.inkFaint}
            strokeWidth="2.5"
            strokeDasharray="7 9"
            fill="none"
          />
        </svg>
        <div style={{ position: "absolute", left: 110, top: 520 }}>
          {ROLES.map((r, i) => (
            <div
              key={r.name}
              style={{ position: "absolute", left: r.x, top: 80 + (r.dy ?? 0) - 80 }}
            >
              <RoleCard name={r.name} line={r.line} delay={18 + i * 11} litAt={130 + i * 22} />
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
}

// --- scene 3: models + effort ---------------------------------------------------------
const MODEL_ROWS = [
  { role: "planner", model: "Fable 5", effort: "xhigh" },
  { role: "coordinator", model: "Opus 4.8", effort: "max" },
  { role: "workers", model: "Opus 4.8", effort: "max" },
  { role: "validator", model: "Opus 4.8", effort: "xhigh" },
  { role: "improver", model: "Fable 5", effort: "xhigh" },
];

function Pill({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 26,
        padding: "8px 18px",
        borderRadius: 10,
        border: `1.5px solid ${accent ? T.accentLine : T.line}`,
        background: accent ? T.accentBg : T.raised,
        color: accent ? T.accentBright : T.ink,
      }}
    >
      {text}
    </span>
  );
}

function Models() {
  const head = useRise(4);
  return (
    <SceneShell duration={MODELS_END - ROLES_END}>
      <AbsoluteFill style={{ padding: "90px 110px" }}>
        <Kicker style={head}>per-role brains</Kicker>
        <div style={{ ...head, marginTop: 18, fontFamily: SANS, fontSize: 64, fontWeight: 750, color: T.ink }}>
          Pick each agent&apos;s model and effort.
        </div>
        <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 25, color: T.inkDim, ...head }}>
          set once at spawn, remembered for the next run
        </div>
        <div
          style={{
            marginTop: 60,
            width: 1050,
            borderRadius: 16,
            border: `1.5px solid ${T.line}`,
            background: T.panel,
            padding: "16px 0",
          }}
        >
          {MODEL_ROWS.map((r, i) => (
            <ModelRow key={r.role} {...r} delay={20 + i * 12} last={i === MODEL_ROWS.length - 1} />
          ))}
        </div>
        <div style={{ marginTop: 34, fontFamily: MONO, fontSize: 24, color: T.inkMid, ...useRise(96) }}>
          heavy reasoning where it pays, max effort where the code gets written.
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
}

function ModelRow({
  role,
  model,
  effort,
  delay,
  last,
}: {
  role: string;
  model: string;
  effort: string;
  delay: number;
  last: boolean;
}) {
  const rise = useRise(delay, 16);
  return (
    <div
      style={{
        ...rise,
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "20px 34px",
        borderBottom: last ? "none" : `1px solid ${T.line}`,
      }}
    >
      <div style={{ width: 290, fontFamily: MONO, fontSize: 30, color: T.ink }}>{role}</div>
      <Pill text={model} />
      <Pill text={`/effort ${effort}`} accent />
    </div>
  );
}

// --- scene 4: the loop shapes ----------------------------------------------------------
const SHAPES = [
  { name: "Land", stop: "drive to done, then stop" },
  { name: "Climb", stop: "push a metric until it stalls" },
  { name: "Hold", stop: "keep an invariant true" },
  { name: "Watch", stop: "digest a stream, each round" },
  { name: "Burst", stop: "fan out once, synthesize" },
  { name: "Sweep", stop: "drain the backlog, wave by wave" },
  { name: "Dig", stop: "dig until the finds run dry" },
  { name: "Race", stop: "competing attempts, one judge" },
];

function EndChip({ text, at }: { text: string; at: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 160 } });
  return (
    <div
      style={{
        opacity: s,
        transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`,
        display: "inline-block",
        fontFamily: MONO,
        fontSize: 27,
        color: T.pass,
        border: `1.5px solid ${T.pass}`,
        borderRadius: 999,
        padding: "9px 22px",
        background: "rgba(91,163,114,0.08)",
      }}
    >
      {text} ✓
    </div>
  );
}

function Loops() {
  const frame = useCurrentFrame();
  const head = useRise(4);
  // Phase 2: the grid recedes, two featured stop-condition panels take over.
  const featured = interpolate(frame, [230, 252], [0, 1], { ...clamp, easing: EASE });
  const drained = Math.min(4, Math.max(0, Math.floor(interpolate(frame, [280, 372], [0, 4.99], clamp))));
  const ms = Math.round(interpolate(frame, [280, 392], [269, 141], { ...clamp, easing: EASE }));
  return (
    <SceneShell duration={LOOPS_END - MODELS_END}>
      <AbsoluteFill style={{ padding: "90px 110px" }}>
        <Kicker style={head}>eight loop shapes</Kicker>
        <div style={{ ...head, marginTop: 18, fontFamily: SANS, fontSize: 64, fontWeight: 750, color: T.ink }}>
          Loops named by how they stop.
        </div>
        <div
          style={{
            marginTop: 54,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 22,
            opacity: 1 - featured * 0.82,
            transform: `scale(${1 - featured * 0.04})`,
            transformOrigin: "top left",
          }}
        >
          {SHAPES.map((s, i) => (
            <ShapeChip key={s.name} {...s} delay={16 + i * 7} />
          ))}
        </div>
        {/* featured stop conditions */}
        <div
          style={{
            position: "absolute",
            left: 110,
            right: 110,
            top: 470,
            display: "flex",
            gap: 30,
            opacity: featured,
            transform: `translateY(${interpolate(featured, [0, 1], [40, 0])}px)`,
          }}
        >
          <div style={featurePanel}>
            <div style={featureTitle}>
              <span style={{ color: T.accent }}>Sweep</span> · a finite backlog
            </div>
            <div style={{ fontFamily: MONO, fontSize: 58, color: T.ink, marginTop: 26 }}>
              drained {drained}/4
            </div>
            <div style={{ marginTop: 30, minHeight: 56 }}>
              {frame >= 396 && <EndChip text="backlog drained" at={396} />}
            </div>
          </div>
          <div style={featurePanel}>
            <div style={featureTitle}>
              <span style={{ color: T.accent }}>Climb</span> · a real metric
            </div>
            <div style={{ fontFamily: MONO, fontSize: 58, color: T.ink, marginTop: 26 }}>
              269 → <span style={{ color: T.accentBright }}>{ms} ms</span>
            </div>
            <div style={{ marginTop: 30, minHeight: 56 }}>
              {frame >= 418 && <EndChip text="plateau: best kept" at={418} />}
            </div>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 110,
            top: 868,
            fontFamily: MONO,
            fontSize: 26,
            color: T.inkMid,
            opacity: interpolate(frame, [430, 452], [0, 1], { ...clamp, easing: EASE }),
          }}
        >
          the cockpit detects the stop condition and lands the swarm itself.
          <div style={{ marginTop: 12, fontSize: 23, color: T.inkDim }}>
            metrics live on a Redis leaderboard. every grade is a Weave Evaluation in Weights &amp;
            Biases.
          </div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
}

const featurePanel: React.CSSProperties = {
  flex: 1,
  borderRadius: 16,
  border: `1.5px solid ${T.line}`,
  background: T.panel,
  padding: "34px 40px",
};
const featureTitle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 30,
  color: T.ink,
};

function ShapeChip({ name, stop, delay }: { name: string; stop: string; delay: number }) {
  const rise = useRise(delay, 18);
  return (
    <div
      style={{
        ...rise,
        borderRadius: 14,
        border: `1.5px solid ${T.line}`,
        background: T.panel,
        padding: "20px 24px",
      }}
    >
      <div style={{ fontFamily: SANS, fontSize: 33, fontWeight: 700, color: T.accent }}>{name}</div>
      <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 20, color: T.inkMid }}>{stop}</div>
    </div>
  );
}

// --- scene 5: the living board ----------------------------------------------------------
const BEADS = [
  { id: 1, dock: 0, slot: 0 },
  { id: 2, dock: 1, slot: 0 },
  { id: 3, dock: 0, slot: 1 },
  { id: 4, dock: 1, slot: 1 },
];
const BACKLOG_X = 250;
const DOCK_X = [800, 800];
const DOCK_Y = [330, 640];
const DONE_X = 1430;

function Bead({ id, dock, slot }: { id: number; dock: number; slot: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const claimDelay = 50 + (id - 1) * 16;
  const doneDelay = 190 + (id - 1) * 14;
  const claim = spring({ frame: frame - claimDelay, fps, config: { damping: 200 } });
  const done = spring({ frame: frame - doneDelay, fps, config: { damping: 200 } });
  const startY = 330 + (id - 1) * 86;
  const dockY = DOCK_Y[dock] + slot * 86;
  const doneY = 330 + (id - 1) * 86;
  const x = interpolate(claim, [0, 1], [BACKLOG_X, DOCK_X[dock]]) + interpolate(done, [0, 1], [0, DONE_X - DOCK_X[dock]]);
  const y = interpolate(claim, [0, 1], [startY, dockY]) + interpolate(done, [0, 1], [0, doneY - dockY]);
  const isDone = done > 0.6;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 240,
        borderRadius: 10,
        border: `1.5px solid ${isDone ? T.pass : claim > 0.4 ? T.accentLine : T.line}`,
        background: T.raised,
        padding: "12px 16px",
        fontFamily: MONO,
        fontSize: 21,
        color: isDone ? T.pass : T.ink,
        boxShadow: claim > 0.4 && !isDone ? "0 0 16px rgba(255,106,26,0.18)" : "none",
      }}
    >
      <span style={{ color: isDone ? T.pass : T.accent }}>{id}</span>
      {"  "}
      {isDone ? `task ${id} done` : `assign task ${id}`}
    </div>
  );
}

function BoardScene() {
  const frame = useCurrentFrame();
  const head = useRise(4);
  const mailCount = Math.min(4, Math.max(0, Math.floor(interpolate(frame, [60, 200], [0, 4.99], clamp))));
  const LINES = [
    "planner: plan ready, tasks 1-4",
    "coordinator: assign task 2 → worker-2",
    "worker-1 done task 1: verified",
    "validator: tasks 1-4 verified green",
  ];
  return (
    <SceneShell duration={BOARD_END - LOOPS_END}>
      <AbsoluteFill style={{ padding: "90px 110px" }}>
        <Kicker style={head}>the board is not an animation</Kicker>
        <div style={{ ...head, marginTop: 18, fontFamily: SANS, fontSize: 64, fontWeight: 750, color: T.ink }}>
          It reads the swarm&apos;s real task lists and mail.
        </div>
        {/* columns */}
        <div style={{ position: "absolute", left: BACKLOG_X + 110, top: 280, ...colLabel }}>backlog</div>
        <div style={{ position: "absolute", left: DOCK_X[0] + 110, top: 280, ...colLabel }}>
          worker docks
          <span
            style={{
              marginLeft: 16,
              padding: "4px 12px",
              borderRadius: 999,
              border: `1.5px solid ${T.accentLine}`,
              background: T.accentBg,
              color: T.accentBright,
              fontSize: 19,
            }}
          >
            ✉ {mailCount}
          </span>
        </div>
        <div style={{ position: "absolute", left: DONE_X + 110, top: 280, ...colLabel }}>done rail</div>
        <div style={{ position: "absolute", left: 110, top: 60 }}>
          {BEADS.map((b) => (
            <Bead key={b.id} {...b} />
          ))}
        </div>
        {/* activity lines */}
        <div style={{ position: "absolute", left: 110, bottom: 100 }}>
          {LINES.map((l, i) => (
            <ActivityLine key={l} text={l} delay={80 + i * 42} />
          ))}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
}

const colLabel: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 22,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: T.inkDim,
};

function ActivityLine({ text, delay }: { text: string; delay: number }) {
  const rise = useRise(delay, 14);
  return (
    <div style={{ ...rise, fontFamily: MONO, fontSize: 23, color: T.inkMid, marginTop: 12 }}>
      <span style={{ color: T.accent }}>▸</span> {text}
    </div>
  );
}

// --- scene 6: close -----------------------------------------------------------------------
const STACK = ["Claude Code swarms", "Redis live bus", "Weights & Biases Weave"];

function Close() {
  const frame = useCurrentFrame();
  const a = useRise(8);
  const b = useRise(30);
  const c = useRise(68);
  const underline = interpolate(frame, [18, 58], [0, 360], { ...clamp, easing: EASE });
  return (
    <SceneShell duration={CLOSE_END - BOARD_END}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              ...a,
              fontFamily: SANS,
              fontSize: 120,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: T.ink,
            }}
          >
            GLASSBOX
          </div>
          <div style={{ height: 4, width: underline, background: T.accent, margin: "10px auto 26px" }} />
          <div style={{ ...b, fontFamily: MONO, fontSize: 32, color: T.inkMid }}>
            real sessions · real coordination · real stops
          </div>
          <div style={{ display: "flex", gap: 18, justifyContent: "center", marginTop: 34 }}>
            {STACK.map((s, i) => (
              <StackPill key={s} text={s} delay={44 + i * 9} />
            ))}
          </div>
          <div style={{ ...c, marginTop: 30, fontFamily: MONO, fontSize: 24, color: T.inkDim }}>
            born at WeaveHacks, a Weights &amp; Biases hackathon · graded by a hard oracle
          </div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
}

function StackPill({ text, delay }: { text: string; delay: number }) {
  const rise = useRise(delay, 16);
  return (
    <span
      style={{
        ...rise,
        display: "inline-block",
        fontFamily: MONO,
        fontSize: 25,
        padding: "10px 22px",
        borderRadius: 999,
        border: `1.5px solid ${T.line}`,
        background: T.raised,
        color: T.ink,
      }}
    >
      {text}
    </span>
  );
}

// --- the composition ------------------------------------------------------------------------
export function MarketingVideo() {
  return (
    <AbsoluteFill style={{ backgroundColor: T.canvas }}>
      <DotGrid />
      <Sequence durationInFrames={OPEN_END}>
        <Open />
      </Sequence>
      <Sequence from={OPEN_END} durationInFrames={ROLES_END - OPEN_END}>
        <Roles />
      </Sequence>
      <Sequence from={ROLES_END} durationInFrames={MODELS_END - ROLES_END}>
        <Models />
      </Sequence>
      <Sequence from={MODELS_END} durationInFrames={LOOPS_END - MODELS_END}>
        <Loops />
      </Sequence>
      <Sequence from={LOOPS_END} durationInFrames={BOARD_END - LOOPS_END}>
        <BoardScene />
      </Sequence>
      <Sequence from={BOARD_END} durationInFrames={CLOSE_END - BOARD_END}>
        <Close />
      </Sequence>
    </AbsoluteFill>
  );
}
