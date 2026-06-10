// Route-level fallback for /swarm. The swarm view mounts tldraw (ssr:false) and
// streams the conductor's live board, so this paints immediately while that
// boots instead of a blank frame.

export default function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas font-mono text-sm text-ink-dim">
      <span className="animate-pulse">booting swarm...</span>
    </div>
  );
}
