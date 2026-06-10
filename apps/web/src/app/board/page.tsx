import type { Metadata } from "next";
import { FleetBoard } from "@/components/fleet/FleetBoard";

export const metadata: Metadata = {
  title: "Glassbox . Board",
  description: "Spatial fleet board: your live sessions clustered by project.",
};

// No server data here: FleetBoard is a client component that polls /api/voxherd
// on mount. Dropping force-dynamic lets this shell prerender as static content,
// so the first paint ships from the build output instead of server-rendering an
// empty shell on every request.
export default function BoardPage() {
  return <FleetBoard />;
}
