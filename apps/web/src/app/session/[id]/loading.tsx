// Route-level fallback for /session/[id]. The detail view opens a terminal
// stream and fetches the session on mount, so this shell paints instantly while
// that connects.

export default function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas font-mono text-sm text-ink-dim">
      <span className="animate-pulse">loading session...</span>
    </div>
  );
}
