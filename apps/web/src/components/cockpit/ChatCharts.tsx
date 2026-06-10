"use client";

// Generative-UI building blocks rendered INSIDE the CopilotKit chat thread.
//
// These mirror the cockpit's correctness curve and leaderboard but are sized and
// styled to sit in a chat bubble. Each fetches /api/leaderboard once and then
// polls briefly so a climb that is still running animates upward in the chat.

import dynamic from "next/dynamic";
import { Fragment, useMemo } from "react";

import { useLeaderboard, type LeaderboardRow } from "@/lib/cockpit/useLeaderboard";

// Lazy boundary: recharts (~130KB gzipped) lives only in this child, so it loads
// on demand instead of riding in the always-mounted cockpit chunk. ssr:false keeps
// it client-only; the curve has its own empty/loading states so no loader is needed.
const Chart = dynamic(() => import("./ChatCorrectnessCurveChart"), {
  ssr: false,
  loading: () => null,
});

export function ChatCorrectnessCurve() {
  const { rows, loaded } = useLeaderboard(true);

  const data = useMemo(
    () =>
      rows
        .slice()
        .sort((a, b) => a.version - b.version)
        .map((r) => ({
          version: r.version,
          accuracy: Math.max(0, Math.min(1, r.accuracy)),
        })),
    [rows],
  );

  const latest = data.length ? data[data.length - 1].accuracy : null;
  const first = data.length ? data[0].accuracy : null;

  return (
    <div className="my-1 w-full rounded-xl border border-accent/30 bg-panel/80 p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent/90">
          correctness curve
        </span>
        <span className="text-[11px] tabular-nums text-ink-dim">
          {data.length ? `v1 to v${data[data.length - 1].version}` : "no runs yet"}
        </span>
      </div>
      <div className="h-[160px] w-full">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-ink-dim">
            {loaded
              ? "no graded runs yet. launch a run or the climb to fill this in."
              : "loading leaderboard..."}
          </div>
        ) : (
          <Chart data={data} />
        )}
      </div>
      {latest !== null && first !== null && (
        <div className="mt-1 flex items-baseline justify-between text-[11px] tabular-nums">
          <span className="text-ink-dim">
            start {(first * 100).toFixed(0)}%
          </span>
          <span className="text-accent">
            latest {(latest * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

// The climb matrix: categories (rows) x planner versions (columns), each cell shaded
// by how well that category passed at that version. It makes the self-improvement
// story legible at a glance: the swarm closes one failing category per version, so
// green fills in as a diagonal staircase climbing toward a fully-covered board.
//
// Data sources, richest first: a version's `by_group` gives the REAL pass fraction
// per category (live graded runs); when absent (the pre-baked demo curve), we fall
// back to cumulative `covered` + `added_category`, which yields a clean binary
// staircase. Either way the cell the version just closed gets an accent ring, so you
// can read the step the swarm took at each column.
export function ChatClimbMatrix() {
  const { rows, loaded } = useLeaderboard(true);

  const { cats, versions, cellAt } = useMemo(() => {
    const sorted = rows.slice().sort((a, b) => a.version - b.version);

    // The version at which each category was first closed (drives row order and the
    // accent "added here" ring). Categories never explicitly added (e.g. the ascii
    // baseline) get Infinity and sort to the bottom.
    const addedAt = new Map<string, number>();
    for (const r of sorted) {
      const c = r.added_category;
      if (c && !addedAt.has(c)) addedAt.set(c, r.version);
    }

    // The full category universe + a cumulative "covered by version v" set, so a
    // category that goes green stays green even if a later version's covered list is
    // noisy (the matrix must climb monotonically, never flicker off).
    const universe = new Set<string>();
    const cumByVersion = new Map<number, Set<string>>();
    const running = new Set<string>();
    for (const r of sorted) {
      for (const c of r.covered ?? []) {
        universe.add(c);
        running.add(c);
      }
      for (const c of Object.keys(r.by_group ?? {})) universe.add(c);
      if (r.added_category) {
        universe.add(r.added_category);
        running.add(r.added_category);
      }
      cumByVersion.set(r.version, new Set(running));
    }

    const cats = [...universe].sort((a, b) => {
      const av = addedAt.get(a) ?? Infinity;
      const bv = addedAt.get(b) ?? Infinity;
      if (av !== bv) return av - bv;
      return a.localeCompare(b);
    });
    const versions = sorted.map((r) => r);

    // Resolve one cell: a real pass fraction from by_group when present, else the
    // binary cumulative-covered fallback. `added` flags the gap closed at this column.
    const cellAt = (r: LeaderboardRow, cat: string) => {
      const bg = r.by_group?.[cat];
      const total = Number(bg?.total ?? 0);
      let frac: number;
      if (bg && total > 0) {
        frac = Math.max(0, Math.min(1, Number(bg.passed ?? 0) / total));
      } else {
        frac = cumByVersion.get(r.version)?.has(cat) ? 1 : 0;
      }
      return { frac, added: r.added_category === cat };
    };

    return { cats, versions, cellAt };
  }, [rows]);

  const cols = versions.length;

  return (
    <div className="my-1 w-full overflow-hidden rounded-xl border border-accent/30 bg-panel/80 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent/90">
          climb matrix
        </span>
        <span className="text-[11px] tabular-nums text-ink-dim">
          {cols ? `${cats.length} categories x v1..v${versions[cols - 1].version}` : "no runs yet"}
        </span>
      </div>

      {cats.length === 0 || cols === 0 ? (
        <div className="flex h-[120px] items-center justify-center text-center text-xs text-ink-dim">
          {loaded
            ? "no graded categories yet. launch the climb to fill the board in."
            : "loading leaderboard..."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `minmax(58px, max-content) repeat(${cols}, minmax(20px, 1fr))`,
            }}
          >
            {/* Header row: corner + version labels. */}
            <div />
            {versions.map((r) => (
              <div
                key={`h-${r.version}`}
                className="text-center text-[10px] font-medium tabular-nums text-ink-dim"
              >
                v{r.version}
              </div>
            ))}

            {/* One row per category, oldest-closed first. */}
            {cats.map((cat) => (
              <Fragment key={cat}>
                <div className="truncate pr-1 text-right text-[10.5px] leading-5 text-ink-mid">
                  {cat}
                </div>
                {versions.map((r) => {
                  const { frac, added } = cellAt(r, cat);
                  return (
                    <div
                      key={`${cat}-${r.version}`}
                      title={`${cat} @ v${r.version}: ${(frac * 100).toFixed(0)}%${added ? " (closed here)" : ""}`}
                      className="h-5 w-full rounded-[3px]"
                      style={{
                        background:
                          frac > 0
                            ? `rgba(255,106,26,${(0.16 + 0.6 * frac).toFixed(3)})`
                            : "rgba(255,255,255,0.06)",
                        boxShadow: added
                          ? "inset 0 0 0 1.5px rgba(255,106,26,0.85)"
                          : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                      }}
                    />
                  );
                })}
              </Fragment>
            ))}

            {/* Footer row: per-version accuracy. */}
            <div className="pr-1 text-right text-[9.5px] uppercase tracking-[0.12em] text-ink-dim">
              acc
            </div>
            {versions.map((r) => (
              <div
                key={`a-${r.version}`}
                className="text-center text-[9.5px] tabular-nums text-accent/80"
              >
                {Math.round(Math.max(0, Math.min(1, r.accuracy)) * 100)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-[10px] text-ink-dim">
        <span className="flex items-center gap-1">
          <span
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ background: "rgba(255,106,26,0.7)" }}
          />
          passing
        </span>
        <span className="flex items-center gap-1">
          <span
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ boxShadow: "inset 0 0 0 1.5px rgba(255,106,26,0.85)" }}
          />
          closed here
        </span>
      </div>
    </div>
  );
}

export function ChatLeaderboard() {
  const { rows, loaded } = useLeaderboard(true);

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => a.version - b.version),
    [rows],
  );

  return (
    <div className="my-1 w-full rounded-xl border border-line/50 bg-panel/80 p-3">
      <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink">
        leaderboard
      </div>
      {sorted.length === 0 ? (
        <div className="text-xs text-ink-dim">
          {loaded ? "no graded runs yet." : "loading leaderboard..."}
        </div>
      ) : (
        <table className="w-full text-left text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.12em] text-ink-dim">
              <th className="pb-1 font-medium">version</th>
              <th className="pb-1 font-medium">added</th>
              <th className="pb-1 text-right font-medium">accuracy</th>
              <th className="pb-1 text-right font-medium">eval</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.version} className="border-t border-line/70">
                <td className="py-1 text-ink-mid">v{r.version}</td>
                <td className="py-1 text-ink-mid">
                  {r.added_category ? `+${r.added_category}` : "baseline"}
                </td>
                <td className="py-1 text-right text-accent">
                  {(Math.max(0, Math.min(1, r.accuracy)) * 100).toFixed(1)}%
                </td>
                <td className="py-1 text-right">
                  {r.weave_eval_url ? (
                    <a
                      href={r.weave_eval_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent/80 underline-offset-2 hover:underline"
                    >
                      Weave ↗
                    </a>
                  ) : (
                    <span className="text-ink-dim">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
