"use client";

// Tells a slide whether it is being rendered inside the deck's hidden print stack
// (the all-slides-at-once copy that only becomes visible during PDF export) versus
// the live on-screen deck. Default is false (on-screen), so the screen path needs
// no provider and keeps its exact behavior; Deck wraps ONLY the print stack in a
// `value={true}` provider.
//
// The live DeckCurve uses this to render a static snapshot (no /api/leaderboard
// poll, no recharts animation) in the print copy: that copy is mounted for the
// whole time /deck is open, so without this it would poll the bridge every 1.5s
// from page load for a chart nobody can see, and a second time once the operator
// navigates to the curve slide. A frozen curve is also the correct thing to bake
// into a PDF.

import { createContext, useContext } from "react";

const PrintContext = createContext(false);

export const PrintProvider = PrintContext.Provider;

export function useIsPrint(): boolean {
  return useContext(PrintContext);
}
