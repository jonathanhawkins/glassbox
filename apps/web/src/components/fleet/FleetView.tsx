"use client";

// The fleet: your live voxherd sessions grouped by project (vibe-view style), sortable
// and collapsible. Click a session to open its detail/console. Phase 1 is REST polling;
// live streaming + the board + archetypes land in the detail view next.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useSessions } from "@/lib/voxherd/useSessions";
import { groupByProject, sortGroups, type SortMode } from "@/lib/fleet/grouping";

// One vivid hue (orange) for the live/running session; calm grays for the rest.
const STATUS_DOT: Record<string, string> = {
  active: "bg-accent",
  waiting: "bg-ink-mid",
  idle: "bg-ink-dim",
};

const SORTS: { id: SortMode; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "agents", label: "Most agents" },
  { id: "name", label: "Name" },
];

export function FleetView() {
  const router = useRouter();
  // Live session list comes from a shared, reference-counted poller so /fleet and the
  // session detail view share one request stream instead of polling independently.
  const { sessions, loaded, error } = useSessions();
  const [sort, setSort] = useState<SortMode>("recent");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => sortGroups(groupByProject(sessions), sort),
    [sessions, sort],
  );

  const toggle = useCallback((project: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen bg-canvas p-6 text-ink-mid">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            Command Center <span className="text-accent">/ fleet</span>
          </h1>
          <p className="text-sm text-ink-dim">
            {sessions.length} live agent{sessions.length === 1 ? "" : "s"} across{" "}
            {groups.length} project{groups.length === 1 ? "" : "s"}, via voxherd-bridge.
            {error && <span className="ml-2 text-fail">bridge: {error}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-raised/60 p-0.5">
          <Link
            href="/board"
            className="rounded-md px-2.5 py-1 font-mono text-[11px] font-medium text-ink-dim transition hover:text-ink"
          >
            board ↗
          </Link>
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition ${
                sort === s.id
                  ? "bg-accent/15 text-accent"
                  : "text-ink-dim hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {/* First load: a skeleton instead of the empty-state copy, so "still
          connecting" no longer reads as "no sessions". */}
      {!loaded && !error && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-line bg-panel/40"
            />
          ))}
        </div>
      )}

      {loaded && groups.length === 0 && !error && (
        <p className="text-sm text-ink-dim">
          no live sessions yet. spawn one in voxherd and it will appear here.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.project);
          return (
            <section key={g.project}>
              <button
                type="button"
                onClick={() => toggle(g.project)}
                className="mb-2 flex w-full items-center gap-2 text-left"
              >
                <span className="text-ink-dim">{isCollapsed ? "▸" : "▾"}</span>
                <span className="font-semibold text-ink">{g.project}</span>
                <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10px] text-ink-mid">
                  {g.sessions.length} agent{g.sessions.length === 1 ? "" : "s"}
                </span>
                {g.isTeam && (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-accent/70">
                    team
                  </span>
                )}
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {g.sessions.map((s) => (
                    <button
                      key={s.session_id}
                      type="button"
                      onClick={() => router.push(`/session/${s.session_id}`)}
                      className="rounded-lg border border-line bg-panel/60 p-3 text-left transition hover:border-accent/50 hover:bg-raised"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium text-ink">
                          {s.project}
                          {s.agent_number ? ` #${s.agent_number}` : ""}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-dim">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status] ?? "bg-ink-dim"}`} />
                          {s.status}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-ink-dim">
                        {s.assistant}
                        {s.activity_type ? ` · ${s.activity_type}` : ""}
                        {s.sub_agent_count ? ` · ${s.sub_agent_count} sub-agents` : ""}
                      </div>
                      {s.last_summary && (
                        <div className="mt-1.5 text-xs text-ink-mid">{s.last_summary}</div>
                      )}
                      {s.terminal_preview && (
                        <pre className="mt-1.5 max-h-20 overflow-hidden whitespace-pre-wrap font-mono text-[10px] leading-tight text-ink-dim">
                          {s.terminal_preview.slice(-320)}
                        </pre>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
