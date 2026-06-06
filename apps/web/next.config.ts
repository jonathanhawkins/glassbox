import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Next only auto-loads app-local .env files, but this app lives in a monorepo and
// the secrets (OPENAI_BASE_URL / OPENAI_API_KEY for the CopilotKit runtime,
// REDIS_URL, NEXT_PUBLIC_BACKEND_URL) live in the repo-root .env. Load that here
// so server route handlers see them in dev, build, and start. Dependency free,
// commits clean (it reads the gitignored .env, never embeds a secret).
try {
  const rootEnv = path.join(__dirname, "..", "..", ".env");
  for (const line of fs.readFileSync(rootEnv, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
} catch {
  // no root .env (e.g. CI); rely on the real environment.
}

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
