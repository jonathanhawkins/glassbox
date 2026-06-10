"use client";

// The Glassbox cockpit lives at "/". tldraw is client-only (it touches window),
// so the board is loaded via next/dynamic with { ssr: false }. The /debug page
// remains the plain transport view.

import dynamic from "next/dynamic";

const CockpitBoard = dynamic(
  () => import("@/components/cockpit/CockpitBoard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-canvas font-mono text-sm text-ink-dim">
        booting cockpit...
      </div>
    ),
  },
);

export default function Home() {
  return (
    <main className="h-full w-full">
      <CockpitBoard />
    </main>
  );
}
