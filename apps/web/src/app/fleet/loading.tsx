// Route-level fallback for /fleet. The fleet view polls /api/voxherd on mount,
// so this shell paints instantly while the first fetch resolves.

export default function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas font-mono text-sm text-ink-dim">
      <span className="animate-pulse">loading fleet...</span>
    </div>
  );
}
