"use client";

// The ranked leaderboard, on the board (not just in chat). Sits under the correctness
// curve in the right rail and shows, per planner version: a status dot, the version, the
// category that version added, an accuracy bar + %, and a deep link to THIS version's
// real Weave Evaluation. Data comes from /api/leaderboard (the sorted set for accuracy
// + ordering, merged with the per-version metadata hash), so the rows and their Weave
// links survive a page reload, e.g. a pre-baked overnight climb shown on a fresh load.

import { useMemo, useState } from "react";

import { useLeaderboard } from "@/lib/cockpit/useLeaderboard";
import type { TaskName } from "@/lib/cockpit/tasks";
import { CollapseButton } from "./CollapseButton";

const STATUS_DOT: Record<string, string> = {
  passed: "bg-pass",
  partial: "bg-accent-bright",
  failed: "bg-fail",
};

/** Derive the project's Weave root from any row's eval URL, for the "all evals" link. */
function weaveProjectRoot(urls: (string | null | undefined)[]): string | null {
  for (const u of urls) {
    if (!u) continue;
    const m = u.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)/);
    if (m) return `${m[1]}/weave`;
  }
  return process.env.NEXT_PUBLIC_WEAVE_URL ?? null;
}

export function LeaderboardPanel({ activeTask }: { activeTask: TaskName }) {
  const { rows, loaded } = useLeaderboard(true, activeTask);
  const [open, setOpen] = useState(true);

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => a.version - b.version),
    [rows],
  );

  // The best row (highest accuracy, ties broken by the later version) gets a star.
  const bestVersion = useMemo(() => {
    let best: { version: number; accuracy: number } | null = null;
    for (const r of sorted) {
      if (!best || r.accuracy >= best.accuracy) best = r;
    }
    return best?.version ?? null;
  }, [sorted]);

  const evalsHref = useMemo(
    () => weaveProjectRoot(sorted.map((r) => r.weave_eval_url)),
    [sorted],
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CollapseButton open={open} onClick={() => setOpen((o) => !o)} label="leaderboard" />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mid">
            leaderboard
          </span>
        </div>
        {evalsHref && sorted.length > 0 && (
          <a
            href={evalsHref}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-accent/80 underline-offset-2 hover:underline"
          >
            open evals in Weave ↗
          </a>
        )}
      </div>

      {!open ? null : sorted.length === 0 ? (
        <div className="mt-1 flex items-center justify-center py-4 text-xs text-ink-dim">
          {loaded ? "waiting for the first graded run" : "loading leaderboard..."}
        </div>
      ) : (
        <div className="mt-1 max-h-[200px] overflow-y-auto pr-1">
          <ul className="flex flex-col gap-1">
            {sorted.map((r) => {
              const acc = Math.max(0, Math.min(1, r.accuracy));
              const dot = (r.status && STATUS_DOT[r.status]) || "bg-ink-dim";
              return (
                <li
                  key={r.version}
                  className="flex items-center gap-2 rounded-lg border border-line bg-raised/40 px-2 py-1 text-[11px] tabular-nums"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
                    title={r.status ?? "unknown"}
                  />
                  <span className="w-7 shrink-0 font-mono font-medium text-ink-mid">
                    {r.version === bestVersion ? "★" : ""}v{r.version}
                  </span>
                  <span className="w-20 shrink-0 truncate text-ink-mid" title={r.added_category ?? "baseline"}>
                    {r.added_category ? `+${r.added_category}` : "baseline"}
                  </span>
                  <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised/80">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-accent/80"
                      style={{ width: `${acc * 100}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-accent">
                    {(acc * 100).toFixed(1)}%
                  </span>
                  <span className="w-12 shrink-0 text-right">
                    {r.weave_eval_url ? (
                      <a
                        href={r.weave_eval_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent/80 underline-offset-2 hover:underline"
                        title="open this version's Weave Evaluation"
                      >
                        Weave ↗
                      </a>
                    ) : (
                      <span className="text-ink-dim">-</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
