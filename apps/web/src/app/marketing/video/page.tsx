"use client";

// /marketing/video: the Glassbox marketing cut, rendered live by the Remotion Player.
// The composition is code (src/remotion/MarketingVideo.tsx), so the video stays in
// lockstep with the product's visual system and copy. Export the mp4 for posting with:
//   npx remotion render src/remotion/index.ts MarketingVideo out/glassbox-marketing.mp4

import { Player } from "@remotion/player";
import Link from "next/link";

import { MarketingVideo } from "@/remotion/MarketingVideo";
import { VIDEO } from "@/remotion/theme";

export default function MarketingVideoPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink-mid">
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <Link href="/fleet" className="font-mono text-sm text-ink-dim transition hover:text-ink">
          &#8592; fleet
        </Link>
        <h1 className="text-lg font-semibold text-ink">
          Marketing video <span className="text-accent">/ remotion</span>
        </h1>
        <span className="ml-auto font-mono text-[11px] text-ink-dim">
          64s · 1920×1080 · render: npx remotion render src/remotion/index.ts MarketingVideo
          out/glassbox-marketing.mp4
        </span>
      </header>
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-[1280px] overflow-hidden rounded-xl border border-line shadow-2xl">
          <Player
            component={MarketingVideo}
            durationInFrames={VIDEO.durationInFrames}
            compositionWidth={VIDEO.width}
            compositionHeight={VIDEO.height}
            fps={VIDEO.fps}
            controls
            loop
            autoPlay
            initiallyMuted
            style={{ width: "100%" }}
          />
        </div>
      </main>
    </div>
  );
}
