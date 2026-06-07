"use client";

// Small chevron toggle shared by the right-rail panels (controls, curve,
// leaderboard, legend). Each panel owns its own open state and collapses to just
// its header, giving the live event feed more room. The chevron points down when
// open and rotates to point right when collapsed.

export function CollapseButton({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={open ? `Hide ${label}` : `Show ${label}`}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
    >
      <svg
        viewBox="0 0 12 12"
        className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 4.5 L6 8 L9.5 4.5" />
      </svg>
    </button>
  );
}
