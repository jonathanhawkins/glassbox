"use client";

// AGENT MAIL: the swarm's conversation, made legible. A right-anchored slide-out
// drawer over the locked board. Every row is a real message one agent sent
// another at a genuine handoff (planner->coordinator, coordinator->worker,
// worker->validator, validator->improver, improver->planner), or a file lease a
// worker took before editing the workspace. Each handoff is sent over the real
// Agent Mail server and carried on the same Redis event stream that drives the
// whole cockpit, so a row can expand into its genuine Agent Mail record (the
// message id, the identities behind the roles, the verified-sender flag, the file
// leases held). Messages are grouped by planner version and accumulate (never
// disappear), so v1->v7 reads as a growing thread climbing with the curve.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  CAP_COLORS,
  agentColor,
  type Capability,
  type MailLease,
  type MailMessage,
} from "@/lib/cockpit/types";

// Left-accent per message kind, so a glance reads the shape of the exchange:
// dispatch/assign/done in the work palette, grade/rewrite in the verdict palette,
// lease in the file-ownership palette.
const KIND_ACCENT: Record<string, string> = {
  dispatch: "#38bdf8", // sky
  assign: "#fbbf24", // amber
  done: "#34d399", // emerald
  "grade-pass": "#22c55e", // green
  "grade-fail": "#fb7185", // rose
  rewrite: "#a78bfa", // violet
  lease: "#2dd4bf", // teal (advisory file lease)
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

// A short clock + relative window for a lease expiry, e.g. "16:38:12 (in 2m)".
function fmtExpires(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const clock = new Date(t).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins > 0) return `${clock} (in ${mins}m)`;
  return `${clock} (expired)`;
}

// The provenance dot: emerald = sent over Agent Mail with a verified sender, teal
// = sent over Agent Mail, slate = Redis mirror only (server was offline). Absent
// for legacy rows that predate the field.
function liveDot(m: MailMessage): { color: string; label: string } | null {
  if (m.real === undefined) return null;
  if (!m.real)
    return { color: "#64748b", label: "Redis mirror (Agent Mail offline)" };
  if (m.verified)
    return { color: "#34d399", label: "sent over Agent Mail (verified sender)" };
  return { color: "#22d3ee", label: "sent over Agent Mail" };
}

function leasePathName(lease: MailLease): string {
  const p = lease.path ?? "";
  return p.split("/").pop() || p;
}

// One labeled line in the expanded detail grid.
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words text-[11px] text-slate-300">
        {children}
      </span>
    </div>
  );
}

// The genuine Agent Mail record for one message, shown when its row is expanded.
function MailDetail({ m }: { m: MailMessage }) {
  const fromFull = m.fromId ? `${m.from} · ${m.fromId}` : m.from;
  const toFull = m.toId ? `${m.to} · ${m.toId}` : m.to;
  const leases = m.leases ?? [];
  const conflicts = m.conflicts ?? [];
  const live = liveDot(m);
  return (
    <div className="mt-2 space-y-1.5 border-t border-slate-800/70 pt-2">
      <DetailRow label="route">
        <span className="text-slate-200">{fromFull}</span>
        <span className="text-slate-600"> → </span>
        <span className="text-slate-200">{toFull}</span>
      </DetailRow>
      {m.body && <DetailRow label="body">{m.body}</DetailRow>}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {m.cap && <DetailRow label="capability">{m.cap}</DetailRow>}
        {m.bead_id && (
          <DetailRow label="bead">
            <span className="font-mono text-[10px] text-slate-400">
              {m.bead_id}
            </span>
          </DetailRow>
        )}
      </div>

      {leases.length > 0 && (
        <DetailRow label="leases">
          <div className="space-y-1">
            {leases.map((lease, i) => {
              const exp = fmtExpires(lease.expires);
              return (
                <div key={`${lease.path}-${i}`} className="leading-snug">
                  <span className="font-mono text-[10px] text-teal-300">
                    {lease.path ?? leasePathName(lease)}
                  </span>
                  <span className="ml-1.5 text-[10px] text-slate-500">
                    {lease.exclusive === false ? "shared" : "exclusive"}
                    {exp ? ` · ${exp}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </DetailRow>
      )}
      {conflicts.length > 0 && (
        <DetailRow label="conflicts">
          <span className="text-rose-300">
            {conflicts.map((c) => c.path).filter(Boolean).join(", ")}
          </span>
        </DetailRow>
      )}

      {/* The Agent Mail system record: proof this is a genuine message, not a
          cosmetic event. Falls back to a clear "mirror only" note when offline. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-800/50 pt-1.5 text-[10px] text-slate-500">
        {live && (
          <span className="inline-flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: live.color }}
            />
            {live.label}
          </span>
        )}
        {m.mailId != null && (
          <span>
            msg <span className="font-mono text-slate-400">#{m.mailId}</span>
          </span>
        )}
        {m.threadId && (
          <span>
            thread{" "}
            <span className="font-mono text-slate-400">{m.threadId}</span>
          </span>
        )}
        {m.importance && m.importance !== "normal" && (
          <span className="text-amber-300/80">{m.importance}</span>
        )}
        {m.projectSlug && (
          <span>
            project{" "}
            <span className="font-mono text-slate-400">{m.projectSlug}</span>
          </span>
        )}
      </div>
    </div>
  );
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
  // Which rows are expanded into their full Agent Mail record (by stable key).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
                    // Content-stable key so expand state survives the mail window
                    // sliding (CockpitBoard caps the buffer): real messages key on
                    // their Agent Mail id; mirror/lease rows fall back to run+ts.
                    const key =
                      m.mailId != null
                        ? `mail-${m.mailId}`
                        : `${m.run_id}-${m.ts}-${m.from}-${m.kind}-${i}`;
                    const isOpen = expanded.has(key);
                    const live = liveDot(m);
                    const hasLease = (m.leases?.length ?? 0) > 0;
                    return (
                      <div
                        key={key}
                        className="rounded-lg border border-slate-800/70 bg-slate-900/40"
                        style={{ borderLeft: `2px solid ${accent}` }}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          aria-expanded={isOpen}
                          className="w-full rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-slate-900/70"
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
                            <div className="flex shrink-0 items-center gap-1.5">
                              {live && (
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ background: live.color }}
                                  title={live.label}
                                />
                              )}
                              <span className="tabular-nums text-[10px] text-slate-600">
                                {fmtTime(m.ts)}
                              </span>
                              <span
                                className={`text-[9px] text-slate-600 transition-transform ${
                                  isOpen ? "rotate-90" : ""
                                }`}
                              >
                                ▸
                              </span>
                            </div>
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
                          {!isOpen && m.body && (
                            <div className="mt-0.5 truncate text-[11px] leading-snug text-slate-400">
                              {m.body}
                            </div>
                          )}
                          {!isOpen && hasLease && (
                            <div className="mt-0.5 truncate text-[10px] leading-snug text-teal-300/80">
                              {m.leases!
                                .map((l) => leasePathName(l))
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                          )}
                        </button>
                        {isOpen && (
                          <div className="px-2.5 pb-2.5">
                            <MailDetail m={m} />
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
