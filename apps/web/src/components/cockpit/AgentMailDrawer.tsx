"use client";

// AGENT MAIL: the swarm's conversation, made legible. A right-anchored slide-out
// drawer over the locked board. Every row is a real message one agent sent
// another at a genuine handoff (planner->coordinator, coordinator->worker,
// worker->validator, validator->improver, improver->planner), carried on the
// same Redis event stream that drives the whole cockpit. Messages are grouped by
// planner version and accumulate (never disappear), so v1->v7 reads as a growing
// thread climbing in lockstep with the correctness curve.

import { useEffect, useMemo, useRef } from "react";

import {
  CAP_COLORS,
  agentColor,
  type Capability,
  type MailMessage,
} from "@/lib/cockpit/types";

// Left-accent per message kind, so a glance reads the shape of the exchange:
// dispatch/assign/done in the work palette, grade/rewrite in the verdict palette.
const KIND_ACCENT: Record<string, string> = {
  dispatch: "#38bdf8", // sky
  assign: "#fbbf24", // amber
  done: "#34d399", // emerald
  "grade-pass": "#22c55e", // green
  "grade-fail": "#fb7185", // rose
  rewrite: "#a78bfa", // violet
  note: "#475569", // slate
};

function fmtTime(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function capColorOf(cap?: string): string | null {
  if (cap && cap in CAP_COLORS) return CAP_COLORS[cap as Capability];
  return null;
}

export function AgentMailDrawer({
  open,
  messages,
  onClose,
}: {
  open: boolean;
  messages: MailMessage[];
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest message in view while the drawer is open and growing.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length]);

  // Close on Escape for keyboard parity with the scrim click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Group chronologically by planner version so each version reads as a thread.
  const groups = useMemo(() => {
    const byVersion = new Map<number, MailMessage[]>();
    for (const m of messages) {
      const arr = byVersion.get(m.version);
      if (arr) arr.push(m);
      else byVersion.set(m.version, [m]);
    }
    return [...byVersion.entries()].sort((a, b) => a[0] - b[0]);
  }, [messages]);

  return (
    <>
      {/* Scrim: dims the board and closes on click. */}
      <div
        className={`absolute inset-0 z-30 bg-black/30 transition-opacity duration-300 ${
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      {/* The slide-out panel. */}
      <aside
        aria-hidden={!open}
        inert={!open}
        className={`absolute right-0 top-0 z-40 flex h-full w-[440px] max-w-[92vw] flex-col border-l border-cyan-500/25 bg-slate-950/90 backdrop-blur transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-800/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-slate-100">
              Agent Mail
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] text-cyan-300/90">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {messages.length} msg
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-200"
          >
            close
          </button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {messages.length === 0 ? (
            <div className="mt-12 text-center text-xs text-slate-600">
              no messages yet. launch a run to watch the swarm talk.
            </div>
          ) : (
            groups.map(([version, msgs]) => (
              <section key={version} className="mb-4">
                <div className="sticky top-0 z-10 -mx-3 mb-2 flex items-center justify-between bg-slate-950/90 px-3 py-1 backdrop-blur">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-violet-300/80">
                    planner v{version}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-600">
                    {msgs.length} msg
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {msgs.map((m, i) => {
                    const accent = KIND_ACCENT[m.kind] ?? KIND_ACCENT.note;
                    const capColor = capColorOf(m.cap);
                    return (
                      <div
                        key={`${m.ts}-${m.from}-${m.kind}-${i}`}
                        className="rounded-lg border border-slate-800/70 bg-slate-900/40 p-2.5"
                        style={{ borderLeft: `2px solid ${accent}` }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: agentColor(m.from) }}
                            />
                            <span className="text-slate-300">{m.from}</span>
                            <span className="text-slate-600">to</span>
                            <span className="text-slate-400">{m.to}</span>
                          </div>
                          <span className="shrink-0 tabular-nums text-[10px] text-slate-600">
                            {fmtTime(m.ts)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-start justify-between gap-2">
                          <span className="text-[12px] font-medium leading-snug text-slate-100">
                            {m.subject}
                          </span>
                          {capColor && (
                            <span
                              className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
                              style={{
                                background: `${capColor}22`,
                                color: capColor,
                              }}
                            >
                              {m.cap}
                            </span>
                          )}
                        </div>
                        {m.body && (
                          <div className="mt-0.5 text-[11px] leading-snug text-slate-400">
                            {m.body}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
