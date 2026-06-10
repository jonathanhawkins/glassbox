// Route-level fallback for the short pitch deck ("/deck/short"). Shown instantly
// on navigation while the static shell streams and the client Deck (keyboard
// nav, charts) hydrates, instead of a blank frame.

export default function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas font-mono text-sm text-ink-dim">
      <span className="animate-pulse">loading deck...</span>
    </div>
  );
}
