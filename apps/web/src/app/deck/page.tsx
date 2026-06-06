import type { Metadata } from "next";
import { Deck } from "@/components/deck/Deck";

// The Glassbox pitch deck (WeaveHacks 4, 3-minute live pitch). This route is a
// thin server component that owns metadata and renders the client Deck shell
// (keyboard nav needs the browser). Additive: it imports the cockpit's curve and
// palette but does not touch any existing route or component.

export const metadata: Metadata = {
  title: "Glassbox . Pitch",
  description:
    "Watch a self-improving swarm build real code, graded live against ground truth.",
};

export default function DeckPage() {
  return <Deck />;
}
