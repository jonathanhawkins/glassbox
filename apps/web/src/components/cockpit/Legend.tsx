"use client";

// Capability color legend. Mirrors lib/cockpit/types CAP_COLORS so the bead
// colors on the board are readable at a glance.

import { CAP_COLORS, CAP_LABELS, type Capability } from "@/lib/cockpit/types";

const ORDER: Capability[] = [
  "ascii",
  "punctuation",
  "numbers",
  "code",
  "unicode",
  "emoji",
  "whitespace",
  "harness",
];

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {ORDER.map((cap) => (
        <span key={cap} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: CAP_COLORS[cap], boxShadow: `0 0 6px ${CAP_COLORS[cap]}` }}
          />
          <span className="text-[10px] tracking-wide text-slate-400">
            {CAP_LABELS[cap]}
          </span>
        </span>
      ))}
    </div>
  );
}
