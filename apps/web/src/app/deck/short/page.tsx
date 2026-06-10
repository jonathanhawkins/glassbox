import type { Metadata } from "next";
import { Deck } from "@/components/deck/Deck";

// The 3-minute cut of the Glassbox pitch. Same deck shell, a curated subset of
// the full deck in presentation order: hook, problem, idea, the self-improvement
// centerpiece (live curve), sponsors (all load-bearing), and the close. We pass
// slide ids (plain strings) so this server component stays clear of the client
// slide graph. Additive: it does not touch /deck.

export const metadata: Metadata = {
  title: "Glassbox . 3-min pitch",
  description:
    "The short cut: a self-improving swarm building real code, graded live against ground truth.",
  openGraph: {
    title: "Glassbox . 3-min pitch",
    description:
      "The short cut: a self-improving swarm building real code, graded live against ground truth.",
  },
  twitter: {
    title: "Glassbox . 3-min pitch",
    description:
      "The short cut: a self-improving swarm building real code, graded live against ground truth.",
  },
};

const SHORT_ORDER = [
  "title",
  "problem",
  "idea",
  "self-improvement",
  "sponsors",
  "close",
];

export default function ShortDeckPage() {
  return <Deck only={SHORT_ORDER} />;
}
