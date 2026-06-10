"use client";

// Lazy boundary for the deck's self-improvement curve. DeckCurve pulls in
// recharts (~340KB of JS), which otherwise rides in the deck's first-load
// bundle even though the curve only appears on one slide. Splitting it behind
// next/dynamic keeps recharts out of the initial deck payload, so the title
// slide paints fast. The fallback holds the panel's height so the curve slide
// does not shift when recharts arrives.

import dynamic from "next/dynamic";

const DeckCurveImpl = dynamic(
  () => import("./DeckCurve").then((m) => m.DeckCurve),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[20rem] w-full items-center justify-center font-mono text-sm text-ink-dim">
        loading curve...
      </div>
    ),
  },
);

export function DeckCurve() {
  return <DeckCurveImpl />;
}
