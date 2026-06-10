import type { Metadata } from "next";
import { Suspense } from "react";
import { SwarmView } from "@/components/fleet/SwarmView";

export const metadata: Metadata = {
  title: "Glassbox . Swarm",
  description: "The swarm command center: a live node board of the conductor's swarm.",
};

// SwarmView reads useSearchParams (client-only). Wrapping it in Suspense lets
// the page shell prerender as static content while the search-params-dependent
// view hydrates on the client, instead of forcing a per-request server render of
// the whole route.
export default function SwarmPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-canvas font-mono text-sm text-ink-dim">
          booting swarm...
        </div>
      }
    >
      <SwarmView />
    </Suspense>
  );
}
