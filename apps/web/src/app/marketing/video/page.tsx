"use client";

// /marketing/video: the Glassbox marketing cut, rendered live by the Remotion Player.
// The composition is code (src/remotion/MarketingVideo.tsx), so the video stays in
// lockstep with the product's visual system and copy. "export mp4" runs the Remotion
// CLI server-side (api/marketing/render) and serves the file back as a download.

import { Player } from "@remotion/player";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { MarketingVideo } from "@/remotion/MarketingVideo";
import { VIDEO } from "@/remotion/theme";

interface RenderJob {
  status: "idle" | "rendering" | "done" | "error";
  progress: number;
  line: string;
}

export default function MarketingVideoPage() {
  const [job, setJob] = useState<RenderJob>({ status: "idle", progress: 0, line: "" });

  // Learn the current job on load (a finished export survives a reload), then poll only
  // while a render is actually running.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/marketing/render", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: RenderJob) => {
          if (alive) setJob(j);
        })
        .catch(() => {});
    void tick();
    const id = setInterval(() => {
      if (job.status === "rendering") void tick();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [job.status]);

  const exportVideo = useCallback(async () => {
    try {
      const r = await fetch("/api/marketing/render", { method: "POST" });
      setJob((await r.json()) as RenderJob);
    } catch {
      /* the poll will pick the state up */
    }
  }, []);

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
          64s · 1920×1080 · 30fps
        </span>
        {job.status === "rendering" ? (
          <span
            className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-[12px] text-accent"
            title={job.line}
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent"
              style={{ animation: "gb-pulse 1.1s ease-in-out infinite" }}
            />
            rendering… {Math.round(job.progress * 100)}%
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void exportVideo()}
            className="rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 font-mono text-[12px] font-semibold text-accent transition hover:bg-accent/25"
            title="render the mp4 server-side with the Remotion CLI (a few minutes; the first export also fetches a headless browser)"
          >
            {job.status === "done" ? "re-export mp4" : "export mp4"}
          </button>
        )}
        {job.status === "done" && (
          <a
            href="/api/marketing/render/file"
            className="rounded-md border border-line px-3 py-1.5 font-mono text-[12px] font-semibold text-ink transition hover:border-accent/40 hover:text-accent"
            title="download out/glassbox-marketing.mp4"
          >
            download mp4
          </a>
        )}
        {job.status === "error" && (
          <span className="max-w-[360px] truncate font-mono text-[12px] text-accent" title={job.line}>
            render failed: {job.line}
          </span>
        )}
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
