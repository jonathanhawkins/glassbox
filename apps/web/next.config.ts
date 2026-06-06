import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The contract package ships raw TS (index.ts) consumed by both the swarm and
  // the cockpit; transpile it through Next so the route handlers can import it.
  transpilePackages: ["@glassbox/contract"],

  // Dev only: allow the loopback hosts we serve the cockpit on (port 3100) to
  // fetch Next dev resources (HMR, on-demand client chunks). Without this, Next
  // 16 blocks the cross-origin dev-resource fetch and the dynamically imported
  // (ssr:false) tldraw board never mounts past its loading fallback.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // This app lives in a pnpm workspace with multiple lockfiles; pin Turbopack's
  // root to the repo root so it stops guessing (silences the dev warning).
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
