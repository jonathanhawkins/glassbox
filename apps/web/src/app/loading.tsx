// Route-level fallback for the cockpit ("/"). Shown instantly on navigation
// while the static shell streams and the client cockpit (tldraw, ssr:false)
// boots, instead of a blank white frame.

export default function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas font-mono text-sm text-ink-dim">
      <span className="animate-pulse">booting cockpit...</span>
    </div>
  );
}
