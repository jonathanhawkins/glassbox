"use client";

// The spatial fleet board: a pan/zoom canvas of your sessions, clustered by project.
// Drag the background to pan, scroll to zoom, click a node to dive into its detail.
// A reliable infinite-canvas v1; the rendering can move onto literal tldraw shapes later.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useSessions } from "@/lib/voxherd/useSessions";
import { groupByProject } from "@/lib/fleet/grouping";

const DOT: Record<string, string> = {
  active: "bg-accent",
  waiting: "bg-amber-400",
  idle: "bg-ink-dim",
};

const COL_W = 300;
const ROW_H = 300;
const COLS = 4;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function FleetBoard() {
  const router = useRouter();
  // Shared, reference-counted session poller: one request stream whether or not
  // FleetView is also mounted (avoids parallel 1.5s poll storms).
  const { sessions } = useSessions();
  const [cam, setCam] = useState({ x: 40, y: 40, z: 1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  // Zoom around the cursor (non-passive wheel so we can preventDefault).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setCam((c) => {
        const z = clamp(c.z * (1 - e.deltaY * 0.0015), 0.3, 2);
        const wx = (cx - c.x) / c.z;
        const wy = (cy - c.y) / c.z;
        return { x: cx - wx * z, y: cy - wy * z, z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const groups = useMemo(() => groupByProject(sessions), [sessions]);

  // Render the nodes once per data change, NOT per camera change. Panning/zooming only
  // mutates the wrapper's transform below, so memoizing the node tree on [groups] lets
  // React bail out of reconciling every session card on each high-frequency wheel/pan
  // tick (the real cost), keeping the gesture synchronous and smooth.
  const nodes = useMemo(
    () =>
      groups.map((g, i) => {
        const left = (i % COLS) * COL_W;
        const top = Math.floor(i / COLS) * ROW_H;
        return (
          <div key={g.project} className="absolute" style={{ left, top, width: COL_W - 24 }}>
            <div className="rounded-2xl border border-line bg-raised/30 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="truncate font-semibold text-ink">{g.project}</span>
                <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] text-ink-dim">
                  {g.sessions.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {g.sessions.map((s) => (
                  <button
                    key={s.session_id}
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => router.push(`/session/${s.session_id}`)}
                    className="rounded-xl border border-line bg-canvas/60 p-2 text-left transition hover:border-accent/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {s.project}
                        {s.agent_number ? ` #${s.agent_number}` : ""}
                      </span>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.status] ?? "bg-ink-dim"}`} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-ink-dim">
                      {s.activity_type || s.status}
                      {s.sub_agent_count ? ` · ${s.sub_agent_count} sub` : ""}
                    </div>
                    {s.last_summary && (
                      <div className="mt-1 line-clamp-2 text-[10px] text-ink-dim">
                        {s.last_summary}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      }),
    [groups, router],
  );

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink-mid">
      <div className="flex items-center gap-3 border-b border-line px-5 py-2">
        <Link href="/fleet" className="font-mono text-sm text-ink-dim transition hover:text-ink">
          &larr; list
        </Link>
        <span className="text-sm font-semibold text-ink">
          Command Center <span className="text-accent">/ board</span>
        </span>
        <span className="text-[11px] text-ink-dim">
          {sessions.length} agents · {groups.length} projects · drag to pan, scroll to zoom
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCam((c) => ({ ...c, z: clamp(c.z - 0.1, 0.3, 2) }))}
            className="rounded border border-line px-2 text-sm text-ink-mid hover:bg-raised"
          >
            &minus;
          </button>
          <span className="w-10 text-center text-[11px] tabular-nums text-ink-dim">
            {Math.round(cam.z * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setCam((c) => ({ ...c, z: clamp(c.z + 0.1, 0.3, 2) }))}
            className="rounded border border-line px-2 text-sm text-ink-mid hover:bg-raised"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onPointerDown={(e) => {
          pan.current = { x: cam.x, y: cam.y, cx: e.clientX, cy: e.clientY };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!pan.current) return;
          setCam((c) => ({
            ...c,
            x: pan.current!.x + (e.clientX - pan.current!.cx),
            y: pan.current!.y + (e.clientY - pan.current!.cy),
          }));
        }}
        onPointerUp={() => {
          pan.current = null;
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`,
            transformOrigin: "0 0",
          }}
        >
          {nodes}
        </div>
      </div>
    </div>
  );
}
