// Shared visual primitives for the Glassbox pitch deck.
//
// These pin the cockpit's design tokens (the warm near-black base, the single
// orange accent, muted green/red semantics, mono labels with wide tracking)
// into a small set of slide building blocks so every slide reads as part of the
// product. Reused by every slide in slides.tsx; nothing here fetches or holds
// state.

import type { ReactNode } from "react";

// Accent families, keyed to the cockpit tokens (globals.css). The deck used to
// rotate a 5-color neon palette per slide; that is what read as "vibe-coded".
// We keep the SAME keys (so slides need no renaming) but collapse them onto the
// disciplined system: orange is the one vivid hue (primary/active), green and
// red stay as muted pass/fail semantics, and the old decorative violet becomes
// calm neutral gray. So `cyan`/`amber` slides are orange, `emerald` is success,
// `rose` is problem, `violet` is quiet.
export const ACCENTS = {
  // Primary. The factory-orange accent, the default for most slides.
  cyan: {
    text: "text-accent",
    dim: "text-accent/80",
    border: "border-accent/40",
    ring: "ring-accent/30",
    bg: "bg-accent/10",
    glow: "rgba(255,106,26,0.16)",
    dot: "bg-accent",
  },
  // Warm. Also orange, a hair brighter, for the "build / bring your own" beats.
  amber: {
    text: "text-accent-bright",
    dim: "text-accent-bright/80",
    border: "border-accent-bright/40",
    ring: "ring-accent-bright/30",
    bg: "bg-accent-bright/10",
    glow: "rgba(255,138,61,0.16)",
    dot: "bg-accent-bright",
  },
  // Success / live. Muted green.
  emerald: {
    text: "text-pass",
    dim: "text-pass/80",
    border: "border-pass/40",
    ring: "ring-pass/30",
    bg: "bg-pass/10",
    glow: "rgba(91,163,114,0.15)",
    dot: "bg-pass",
  },
  // Folded into the primary accent so the deck has ONE consistent accent hue
  // (was a separate neutral gray, which read as an odd colorless accent slot).
  violet: {
    text: "text-accent",
    dim: "text-accent/80",
    border: "border-accent/40",
    ring: "ring-accent/30",
    bg: "bg-accent/10",
    glow: "rgba(255,106,26,0.16)",
    dot: "bg-accent",
  },
  // Problem / failure. Muted red.
  rose: {
    text: "text-fail",
    dim: "text-fail/80",
    border: "border-fail/40",
    ring: "ring-fail/30",
    bg: "bg-fail/10",
    glow: "rgba(216,90,82,0.15)",
    dot: "bg-fail",
  },
} as const;

export type AccentName = keyof typeof ACCENTS;

/**
 * The full-viewport frame every slide sits in. Owns the cockpit vignette wash
 * tinted to the slide's accent, the centered max-width column, and consistent
 * generous padding so copy stays readable across a room.
 */
export function SlideShell({
  accent = "cyan",
  children,
}: {
  accent?: AccentName;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden px-[6vw] py-[7vh]">
      {/* Accent vignette, mirroring the cockpit's radial wash. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 50% -10%, ${a.glow}, transparent 60%)`,
        }}
      />
      {/* Faint grid so the dark field reads as a cockpit surface, not a void. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(120% 100% at 50% 30%, black 30%, transparent 80%)",
        }}
      />
      <div className="relative z-10 mx-auto w-full max-w-5xl">{children}</div>
    </div>
  );
}

/** The small mono eyebrow above a slide title. */
export function Eyebrow({
  accent = "cyan",
  children,
}: {
  accent?: AccentName;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`mb-5 inline-flex items-center gap-2.5 font-mono text-sm uppercase tracking-[0.32em] ${a.dim}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${a.dot}`} />
      {children}
    </div>
  );
}

/** A slide title. Tight leading, strong hierarchy, large for projection. */
export function Title({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-balance text-5xl font-semibold leading-[1.04] tracking-tight text-ink">
      {children}
    </h2>
  );
}

/** Supporting paragraph under a title. */
export function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-3xl text-pretty text-xl leading-relaxed text-ink-mid">
      {children}
    </p>
  );
}

/** A compact takeaway banner. */
export function Takeaway({
  accent = "cyan",
  children,
}: {
  accent?: AccentName;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`mt-7 rounded-lg border ${a.border} ${a.bg} px-4 py-3 text-pretty text-base leading-relaxed text-ink`}
    >
      <span className={`font-mono text-xs uppercase tracking-[0.18em] ${a.text}`}>
        the takeaway
      </span>
      <span className="ml-3">{children}</span>
    </div>
  );
}

/** A small capsule, used for stack chips and quiet labels. */
export function Pill({
  accent = "cyan",
  children,
}: {
  accent?: AccentName;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <span
      className={`inline-flex items-center rounded-full border ${a.border} ${a.bg} px-3 py-1 font-mono text-sm ${a.text}`}
    >
      {children}
    </span>
  );
}

/** Inline monospace token, for code-ish identifiers in prose. */
export function Mono({
  accent,
  children,
}: {
  accent?: AccentName;
  children: ReactNode;
}) {
  const color = accent ? ACCENTS[accent].text : "text-ink";
  return (
    <code
      className={`rounded-md bg-raised px-1.5 py-0.5 font-mono text-[0.9em] ${color}`}
    >
      {children}
    </code>
  );
}

/**
 * A glass panel matching the cockpit's overlay cards (hairline neutral border,
 * translucent panel fill, backdrop blur). Optional accent tints the border for
 * emphasis.
 */
export function Panel({
  accent,
  className = "",
  children,
}: {
  accent?: AccentName;
  className?: string;
  children: ReactNode;
}) {
  const border = accent ? ACCENTS[accent].border : "border-line";
  return (
    <div
      className={`rounded-xl border ${border} bg-panel/70 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}

/** A labeled stat block, e.g. the headline numbers. */
export function Stat({
  value,
  label,
  accent = "cyan",
}: {
  value: ReactNode;
  label: ReactNode;
  accent?: AccentName;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-4xl font-bold tabular-nums ${a.text}`}>
        {value}
      </span>
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-dim">
        {label}
      </span>
    </div>
  );
}
