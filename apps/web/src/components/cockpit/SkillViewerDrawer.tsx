"use client";

// SkillViewerDrawer: read the planner's actual SKILL.md and step through every
// version (v1..vN) to watch the self-improvement happen. A right-slide drawer
// positioned `fixed` so it covers the viewport and can be mounted from anywhere
// (here, from the bottom-center skill strip). Data comes from GET /api/skill
// (the live Redis mirror glassbox:skill, which is file-backed). For each version
// it highlights the lines ADDED since the previous version, so the new coverage
// category line and each new "## Revision vN" rationale stand out in green.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  CAP_COLORS,
  CAP_LABELS,
  CATEGORY_ORDER,
  type Capability,
} from "@/lib/cockpit/types";

type SkillVersion = { version: number; covered: string[]; text: string };
type SkillData = {
  current: string;
  covered: string[];
  versions: SkillVersion[];
};

export function SkillViewerDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<SkillData | null>(null);
  const [acc, setAcc] = useState<Record<number, number>>({});
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Load the skill + per-version accuracy each time the drawer opens, so the
  // versions reflect the latest climb.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/skill", { cache: "no-store" });
        const d = (await res.json()) as SkillData;
        if (cancelled) return;
        const versions = Array.isArray(d?.versions) ? d.versions : [];
        setData({
          current: d?.current ?? "",
          covered: d?.covered ?? [],
          versions,
        });
        setIdx(versions.length ? versions.length - 1 : 0);
        setError(
          versions.length ? null : "no skill versions yet (run a climb first)",
        );
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "failed to load skill");
      }
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const rows = (await res.json()) as {
          version: number;
          accuracy: number;
        }[];
        if (!cancelled && Array.isArray(rows)) {
          const m: Record<number, number> = {};
          for (const r of rows) m[r.version] = r.accuracy;
          setAcc(m);
        }
      } catch {
        // accuracy is optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const versions = data?.versions ?? [];
  const maxIdx = versions.length - 1;
  const cur = versions[idx];
  const prev = idx > 0 ? versions[idx - 1] : null;

  const prevSet = useMemo(() => {
    const s = new Set<string>();
    if (prev)
      for (const l of prev.text.split("\n")) {
        const t = l.trim();
        if (t) s.add(t);
      }
    return s;
  }, [prev]);

  const go = useCallback(
    (delta: number) => setIdx((i) => Math.max(0, Math.min(maxIdx, i + delta))),
    [maxIdx],
  );

  const coveredSet = new Set(cur?.covered ?? []);

  // Portal to <body> so the drawer escapes the strip's transformed wrapper (a
  // `fixed` element inside a transformed ancestor is positioned relative to that
  // ancestor, not the viewport). The board is client-only, so document exists.
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(680px,94vw)] flex-col border-l border-violet-500/30 bg-slate-950/95 backdrop-blur transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800/70 px-4 py-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-violet-300/90">
              planner skill
            </div>
            <div className="mt-0.5 text-sm text-slate-300">
              the skill the planner rewrites to improve itself
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
          >
            close
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-800/70 px-4 py-2.5">
          <button
            onClick={() => go(-1)}
            disabled={idx <= 0}
            className="rounded-md border border-slate-700/60 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800/60 disabled:opacity-40"
            aria-label="previous version"
          >
            {"◀"}
          </button>
          <div className="flex flex-wrap items-center gap-1">
            {versions.map((v, i) => (
              <button
                key={v.version}
                onClick={() => setIdx(i)}
                className={`rounded-md px-2 py-1 text-[11px] tabular-nums transition ${
                  i === idx
                    ? "border border-violet-500/60 bg-violet-500/15 text-violet-100"
                    : "border border-slate-800/70 bg-slate-900/40 text-slate-500 hover:text-slate-300"
                }`}
              >
                v{v.version}
              </button>
            ))}
          </div>
          <button
            onClick={() => go(1)}
            disabled={idx >= maxIdx}
            className="rounded-md border border-slate-700/60 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800/60 disabled:opacity-40"
            aria-label="next version"
          >
            {"▶"}
          </button>
          {cur && (
            <span className="ml-auto text-[11px] tabular-nums text-slate-400">
              {coveredSet.size}/{CATEGORY_ORDER.length} covered
              {acc[cur.version] !== undefined
                ? ` · ${(acc[cur.version] * 100).toFixed(0)}%`
                : ""}
            </span>
          )}
        </div>

        {cur && (
          <div className="flex flex-wrap gap-1.5 border-b border-slate-800/70 px-4 py-2.5">
            {CATEGORY_ORDER.map((c) => {
              const on = coveredSet.has(c);
              const justAdded = !!prev && on && !new Set(prev.covered).has(c);
              const color = CAP_COLORS[c as Capability];
              return (
                <span
                  key={c}
                  className="rounded-full border px-2 py-0.5 text-[10px]"
                  style={{
                    color: on ? color : "#64748b",
                    borderColor: on ? `${color}66` : "rgba(100,116,139,0.3)",
                    background: on ? `${color}1f` : "transparent",
                    boxShadow: justAdded ? `0 0 8px ${color}` : undefined,
                  }}
                >
                  {justAdded ? "+ " : ""}
                  {CAP_LABELS[c as Capability]}
                </span>
              );
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error && !cur ? (
            <div className="text-xs text-slate-500">{error}</div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
              {(cur?.text ?? "").split("\n").map((line, i) => {
                const t = line.trim();
                const added = prev != null && t.length > 0 && !prevSet.has(t);
                return (
                  <div
                    key={i}
                    className={
                      added
                        ? "-mx-1 rounded-sm border-l-2 border-emerald-400/70 bg-emerald-500/10 px-1 text-emerald-200"
                        : undefined
                    }
                  >
                    {line || " "}
                  </div>
                );
              })}
            </pre>
          )}
        </div>

        <div className="border-t border-slate-800/70 px-4 py-2 text-[10px] text-slate-500">
          {cur
            ? `source: agents/planner/history/v${cur.version}.md · cached live in Redis (glassbox:skill)`
            : "source: agents/planner/history · Redis glassbox:skill"}
        </div>
      </aside>
    </>,
    document.body,
  );
}
