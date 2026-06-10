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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CAP_COLORS,
  agentColor,
  type Capability,
  type MailLease,
  type MailMessage,
} from "@/lib/cockpit/types";

// A 1–2 char monogram for the sender avatar (Gmail-style round badge): workers
// keep their lane number (W1..W4); the single-instance agents use their first
// initial (P, C, V, I, S). The avatar fill is the sender's lane color — see
// agentColor — so identity reads from the left edge of every row.
function agentInitials(agent: string): string {
  const w = /^worker-(\d+)$/.exec(agent);
  if (w) return `W${w[1]}`;
  return (agent.trim()[0] ?? "?").toUpperCase();
}

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

// The provenance dot: pass = sent over Agent Mail with a verified sender, accent
// = sent over Agent Mail, ink-dim = Redis mirror only (server was offline). Absent
// for legacy rows that predate the field.
function liveDot(m: MailMessage): { color: string; label: string } | null {
  if (m.real === undefined) return null;
  if (!m.real)
    return { color: "#6e6e73", label: "Redis mirror (Agent Mail offline)" };
  if (m.verified)
    return { color: "#5ba372", label: "sent over Agent Mail (verified sender)" };
  return { color: "#ff6a1a", label: "sent over Agent Mail" };
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
      <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-dim">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words text-[11px] text-ink-mid">
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
    <div className="mt-2 space-y-1.5 border-t border-line pt-2">
      <DetailRow label="route">
        <span className="text-ink">{fromFull}</span>
        <span className="text-ink-dim"> → </span>
        <span className="text-ink">{toFull}</span>
      </DetailRow>
      {m.body && <DetailRow label="body">{m.body}</DetailRow>}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {m.cap && <DetailRow label="capability">{m.cap}</DetailRow>}
        {m.bead_id && (
          <DetailRow label="bead">
            <span className="font-mono text-[10px] text-ink-mid">
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
                  <span className="font-mono text-[10px] text-ink-mid">
                    {lease.path ?? leasePathName(lease)}
                  </span>
                  <span className="ml-1.5 text-[10px] text-ink-dim">
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
          <span className="text-fail">
            {conflicts.map((c) => c.path).filter(Boolean).join(", ")}
          </span>
        </DetailRow>
      )}

      {/* The Agent Mail system record: proof this is a genuine message, not a
          cosmetic event. Falls back to a clear "mirror only" note when offline. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/50 pt-1.5 text-[10px] text-ink-dim">
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
            msg <span className="font-mono text-ink-mid">#{m.mailId}</span>
          </span>
        )}
        {m.threadId && (
          <span>
            thread{" "}
            <span className="font-mono text-ink-mid">{m.threadId}</span>
          </span>
        )}
        {m.importance && m.importance !== "normal" && (
          <span className="text-accent-bright/80">{m.importance}</span>
        )}
        {m.projectSlug && (
          <span>
            project{" "}
            <span className="font-mono text-ink-mid">{m.projectSlug}</span>
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

  const toggle = useCallback((key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    }), []);

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
        className={`absolute right-0 top-0 z-40 flex h-full w-[440px] max-w-[92vw] flex-col border-l border-accent/25 bg-panel/90 backdrop-blur transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-line/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-ink">
              Agent Mail
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[9px] text-accent/90">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {messages.length} msg
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-ink-mid transition-colors hover:bg-raised/60 hover:text-ink"
          >
            close
          </button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {messages.length === 0 ? (
            <div className="mt-12 text-center text-xs text-ink-dim">
              no messages yet. launch a run to watch the swarm talk.
            </div>
          ) : (
            groups.map(([version, msgs]) => (
              <section key={version} className="mb-4">
                <div className="sticky top-0 z-10 -mx-3 mb-2 flex items-center justify-between bg-panel/90 px-3 py-1 backdrop-blur">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-ink-mid">
                    planner v{version}
                  </span>
                  <span className="text-[10px] tabular-nums text-ink-dim">
                    {msgs.length} msg
                  </span>
                </div>
                <div className="flex flex-col">
                  {msgs.map((m, i) => {
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
                        className="border-b border-line/40 last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          aria-expanded={isOpen}
                          className="flex w-full items-start gap-3 px-2 py-2.5 text-left transition-colors hover:bg-raised/60"
                        >
                          {/* Sender avatar: identity icon on the LEFT, beside the
                              content (Gmail-app row), not stacked on top of it. */}
                          <span
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none"
                            style={{
                              background: `${agentColor(m.from)}26`,
                              color: agentColor(m.from),
                            }}
                            aria-hidden
                          >
                            {agentInitials(m.from)}
                          </span>

                          {/* Content column: sender→recipient, subject, snippet —
                              each a single truncating line to the right of the
                              avatar, exactly like a Gmail list row. */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-[12px]">
                                <span className="font-semibold text-ink">
                                  {m.from}
                                </span>
                                <span className="text-ink-dim"> → {m.to}</span>
                              </span>
                              {live && (
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{ background: live.color }}
                                  title={live.label}
                                />
                              )}
                              <time className="shrink-0 tabular-nums text-[10px] text-ink-dim">
                                {fmtTime(m.ts)}
                              </time>
                            </div>

                            <div className="mt-0.5 flex items-center gap-2">
                              <span
                                className={`min-w-0 flex-1 truncate text-[12.5px] font-medium leading-snug ${
                                  m.kind === "grade-fail"
                                    ? "text-fail"
                                    : "text-ink"
                                }`}
                              >
                                {m.subject}
                              </span>
                              {capColor && (
                                <span
                                  className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
                                  style={{
                                    background: `${capColor}22`,
                                    color: capColor,
                                  }}
                                >
                                  {m.cap}
                                </span>
                              )}
                              <span
                                className={`shrink-0 text-[9px] text-ink-dim transition-transform ${
                                  isOpen ? "rotate-90" : ""
                                }`}
                                aria-hidden
                              >
                                ▸
                              </span>
                            </div>

                            {!isOpen && m.body && (
                              <p className="mt-0.5 truncate text-[11px] leading-snug text-ink-mid">
                                {m.body}
                              </p>
                            )}
                            {!isOpen && hasLease && (
                              <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] leading-snug text-ink-mid/80">
                                <span aria-hidden>📎</span>
                                {m.leases!
                                  .map((l) => leasePathName(l))
                                  .filter(Boolean)
                                  .join(", ")}
                              </p>
                            )}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="pb-3 pl-14 pr-3">
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
