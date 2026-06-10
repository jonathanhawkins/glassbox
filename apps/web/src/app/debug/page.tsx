import type { Metadata } from "next";
import { DebugClient } from "./DebugClient";

// Server shell for the transport debug page. The live logic (SSE + polling)
// lives in DebugClient ("use client"); keeping the page a server component lets
// it export route metadata, which a client component cannot do.
export const metadata: Metadata = {
  title: "Glassbox . Transport debug",
  description:
    "End-to-end transport proof: live SSE event feed, leaderboard polling, run and climb controls.",
  openGraph: {
    title: "Glassbox . Transport debug",
    description:
      "End-to-end transport proof: live SSE event feed, leaderboard polling, run and climb controls.",
  },
  twitter: {
    title: "Glassbox . Transport debug",
    description:
      "End-to-end transport proof: live SSE event feed, leaderboard polling, run and climb controls.",
  },
};

export default function DebugPage() {
  return <DebugClient />;
}
