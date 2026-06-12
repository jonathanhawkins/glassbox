// Server-side Remotion render job for the marketing video: the /marketing/video page's
// "export mp4" button POSTs to start it, then polls GET for progress, then downloads the
// file. One job at a time (a render saturates the CPU; a second one would just fight it),
// held as module state so the start/status/file routes all see the same job. Dev-server
// scoped on purpose: this is a workstation export button, not a render farm.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface RenderJob {
  status: "idle" | "rendering" | "done" | "error";
  /** 0..1 across the frame-render phase (bundling shows as 0 with a live line). */
  progress: number;
  /** The CLI's latest output line, for the status readout. */
  line: string;
  startedAt?: number;
}

const OUT_REL = path.join("out", "glassbox-marketing.mp4");

function outAbs(): string {
  return path.join(process.cwd(), OUT_REL);
}

const job: RenderJob = {
  // A file from an earlier export means "done" from the first poll, so the download
  // link is available immediately after a dev-server restart.
  status: fs.existsSync(outAbs()) ? "done" : "idle",
  progress: fs.existsSync(outAbs()) ? 1 : 0,
  line: fs.existsSync(outAbs()) ? "previous export available" : "",
};

export function getRenderJob(): RenderJob {
  return job;
}

export function startRender(): RenderJob {
  if (job.status === "rendering") return job;
  job.status = "rendering";
  job.progress = 0;
  job.line = "bundling the composition…";
  job.startedAt = Date.now();

  fs.mkdirSync(path.dirname(outAbs()), { recursive: true });
  const bin = path.join(process.cwd(), "node_modules", ".bin", "remotion");
  const child = spawn(
    bin,
    ["render", "src/remotion/index.ts", "MarketingVideo", OUT_REL, "--overwrite"],
    { cwd: process.cwd(), env: process.env },
  );

  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    // The CLI reports frame progress as "<rendered>/<total>"; take the newest match.
    const frames = [...text.matchAll(/(\d+)\/(\d+)/g)].pop();
    if (frames) {
      const p = Number(frames[1]) / Number(frames[2]);
      if (Number.isFinite(p) && p > 0 && p <= 1) job.progress = p;
    }
    const line = text
      .split("\n")
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()) // strip ANSI color
      .filter(Boolean)
      .pop();
    if (line) job.line = line.slice(0, 200);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (e) => {
    job.status = "error";
    job.line = e.message;
  });
  child.on("exit", (code) => {
    if (code === 0 && fs.existsSync(outAbs())) {
      job.status = "done";
      job.progress = 1;
      job.line = "export complete";
    } else if (job.status !== "error") {
      job.status = "error";
      job.line = job.line || `render exited with code ${code}`;
    }
  });

  return job;
}

/** The rendered file's absolute path, or null while it does not exist. */
export function renderedFile(): string | null {
  return fs.existsSync(outAbs()) ? outAbs() : null;
}
