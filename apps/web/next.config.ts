import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The contract package ships raw TS (index.ts) consumed by both the swarm and
  // the cockpit; transpile it through Next so the route handlers can import it.
  transpilePackages: ["@glassbox/contract"],
};

export default nextConfig;
