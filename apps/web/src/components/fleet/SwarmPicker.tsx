"use client";

// The conductor picker, as a nested tree instead of a flat <select> that balloons with every
// spawned worker. Top level stays compact: one row per spawned SWARM (its driving conductor)
// plus standalone sessions grouped by project. Click a swarm to expand its nested sub-agent
// workers (named by role: planner, coordinator, worker-1, validator, improver). Picking any row
// selects it as the conductor so you can drive or inspect that exact node.

import { useEffect, useRef, useState } from "react";

import type { VoxSession } from "@/lib/voxherd/types";
import type { SwarmRoster } from "@/lib/fleet/swarm-cache";

const dot = (status?: string) =>
  status === "active" ? "text-accent" : status === "waiting" ? "text-[#a88a5c]" : "text-ink-dim";

function PickerRow({
  s,
  label,
  value,
  onPick,
  indent,
}: {
  s: VoxSession;
  label: string;
  value: string;
  onPick: (id: string) => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(s.session_id)}
      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition hover:bg-raised/70 ${
        s.session_id === value ? "text-ink" : "text-ink-mid"
      } ${indent ? "pl-6" : ""}`}
    >
      <span className={dot(s.status)}>&#9679;</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[9px] uppercase tracking-wide text-ink-dim">{s.status}</span>
    </button>
  );
}

export function SwarmPicker({
  sessions,
  value,
  onChange,
  swarms,
}: {
  sessions: VoxSession[];
  value: string;
  onChange: (id: string) => void;
  swarms: Record<string, SwarmRoster>;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedProj, setExpandedProj] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const byId = (id: string) => sessions.find((s) => s.session_id === id);

  // worker session id -> {conductor, node}; collect conductor ids of live swarms.
  const workerOf: Record<string, { conductor: string; node: string }> = {};
  for (const sw of Object.values(swarms)) {
    for (const [node, sid] of Object.entries(sw.nodes)) workerOf[sid] = { conductor: sw.conductor, node };
  }
  const liveSwarms = Object.values(swarms)
    .filter((sw) => byId(sw.conductor))
    .sort((a, b) => b.ts - a.ts);
  const conductorIds = new Set(liveSwarms.map((sw) => sw.conductor));

  // Standalone = neither a swarm conductor nor a worker of any swarm; grouped by project.
  const standalone = sessions.filter((s) => !workerOf[s.session_id] && !conductorIds.has(s.session_id));
  const byProject: Record<string, VoxSession[]> = {};
  for (const s of standalone) (byProject[s.project] ??= []).push(s);

  const labelFor = (id: string): string => {
    const s = byId(id);
    if (!s) return "pick a session…";
    if (s.window_name) return s.window_name; // voxherd-level role name (once the bridge supports it)
    const w = workerOf[id];
    if (w) return `${s.project} · ${w.node}`;
    if (conductorIds.has(id)) return `${s.project} swarm`;
    return `${s.project}${s.agent_number ? ` #${s.agent_number}` : ""}`;
  };

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-line bg-canvas/70 px-2 py-1 text-xs text-ink outline-none transition hover:border-accent/40"
      >
        <span className="max-w-[190px] truncate">{labelFor(value)}</span>
        <span className="text-ink-dim">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-[64vh] w-[288px] overflow-auto rounded-lg border border-line bg-raised/95 p-1.5 shadow-xl backdrop-blur">
          {liveSwarms.length === 0 && standalone.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-ink-dim">no sessions yet.</p>
          )}

          {liveSwarms.map((sw) => {
            const cond = byId(sw.conductor);
            if (!cond) return null;
            const isExp = expanded[sw.conductor] ?? false; // compact by default; click to expand
            const workers = Object.entries(sw.nodes)
              .map(([node, sid]) => ({ node, s: byId(sid) }))
              .filter((w): w is { node: string; s: VoxSession } => Boolean(w.s));
            return (
              <div key={sw.conductor} className="mb-1">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [sw.conductor]: !isExp }))}
                    className="shrink-0 rounded px-1 text-ink-dim transition hover:text-ink"
                    title={isExp ? "collapse workers" : "expand workers"}
                  >
                    {isExp ? "▾" : "▸"}
                  </button>
                  <button
                    type="button"
                    onClick={() => pick(sw.conductor)}
                    className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] font-semibold transition hover:bg-raised/70 ${
                      sw.conductor === value ? "text-accent" : "text-ink"
                    }`}
                  >
                    <span className={dot(cond.status)}>&#9679;</span>
                    <span className="min-w-0 flex-1 truncate">{cond.project} swarm</span>
                    <span className="shrink-0 text-[9px] text-ink-dim">{workers.length} workers</span>
                  </button>
                </div>
                {isExp &&
                  (workers.length ? (
                    workers.map((w) => (
                      <PickerRow key={w.s.session_id} s={w.s} label={w.s.window_name || w.node} value={value} onPick={pick} indent />
                    ))
                  ) : (
                    <p className="pl-6 text-[10px] text-ink-dim">workers have been cleaned up</p>
                  ))}
              </div>
            );
          })}

          {Object.entries(byProject).map(([project, list]) => {
            const isExp = expandedProj[project] ?? list.length <= 4; // small groups open, big ones compact
            return (
              <div key={project} className="mb-1 border-t border-line/60 pt-1 first:border-t-0">
                <button
                  type="button"
                  onClick={() => setExpandedProj((e) => ({ ...e, [project]: !isExp }))}
                  className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-ink-dim transition hover:text-ink"
                >
                  <span>{isExp ? "▾" : "▸"}</span>
                  <span className="min-w-0 flex-1 truncate">{project}</span>
                  <span>{list.length}</span>
                </button>
                {isExp &&
                  list.map((s) => (
                    <PickerRow
                      key={s.session_id}
                      s={s}
                      label={s.window_name || `${s.project}${s.agent_number ? ` #${s.agent_number}` : ""}`}
                      value={value}
                      onPick={pick}
                      indent
                    />
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
