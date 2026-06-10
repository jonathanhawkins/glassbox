import type { Metadata } from "next";
import { FleetView } from "@/components/fleet/FleetView";

export const metadata: Metadata = {
  title: "Glassbox . Fleet",
  description: "Your live voxherd sessions grouped by project.",
};

// No server data here: FleetView polls /api/voxherd on mount. Dropping
// force-dynamic lets this shell prerender as static content, so the first paint
// ships from the build output instead of a per-request server render.
export default function FleetPage() {
  return <FleetView />;
}
