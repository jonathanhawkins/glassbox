import type { Metadata } from "next";
import { SessionDetail } from "@/components/fleet/SessionDetail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Glassbox . Session ${id}`,
    description: "One session's live console, loop archetypes, and skills.",
  };
}

// SessionDetail reads the route id via useParams and fetches on the client, so
// the server render is just a shell. Dropping force-dynamic removes the explicit
// opt-out of the full-route cache and lets Next serve that shell without a fresh
// server render on every request.
export default function SessionPage() {
  return <SessionDetail />;
}
