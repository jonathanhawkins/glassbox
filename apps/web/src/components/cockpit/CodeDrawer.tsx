"use client";

// CodeDrawer: read the REAL source the swarm wrote and step through every version
// (v1..vN) to watch it grow. The sibling of the planner-skill viewer, but pointed at
// the task's workspace files instead of SKILL.md, so people can see HOW the AI is
// doing this: the actual Rust / Python it authored, with the lines ADDED since the
// previous version highlighted green. Data is GET /api/code?task= (the live files
// plus every per-version snapshot, read on demand). For a multi-file task (textkit)
// it shows a file tab per edit target and defaults to the file that changed most at
// the selected version. With no version history yet (a single run, or fresh) it
// falls back to the current code with a hint to run a climb. A right-slide drawer
// portaled to <body> so it covers the viewport regardless of where it is mounted.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { TaskName } from "@/lib/cockpit/tasks";

type CodeVersion = {
  version: number;
  files: Record<string, string>;
  covered?: string[];
  accuracy?: number;
};
type CodeData = {
  edit_targets: string[];
  unit: string;
  current: Record<string, string>;
  versions: CodeVersion[];
};

const EMPTY: CodeData = { edit_targets: [], unit: "category", current: {}, versions: [] };

// Trimmed non-empty lines of a file, for the added-line diff against the prior version.
function lineSet(text: string): Set<string> {
  const s = new Set<string>();
  for (const l of text.split("\n")) {
    const t = l.trim();
    if (t) s.add(t);
  }
  return s;
}

function baseName(rel: string): string {
  const parts = rel.split("/");
  return parts[parts.length - 1] || rel;
}

export function CodeDrawer({
  open,
  onClose,
  activeTask,
}: {
  open: boolean;
  onClose: () => void;
  activeTask: TaskName;
}) {
  const [data, setData] = useState<CodeData>(EMPTY);
  const [idx, setIdx] = useState(0);
  // The manually-clicked file tab (null = follow the per-version default below).
  const [userFile, setUserFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the workspace code each time the drawer opens (or the task changes while
  // open), so the versions + files reflect the latest climb of the active task.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/code?task=${encodeURIComponent(activeTask)}`, {
          cache: "no-store",
        });
        const d = (await res.json()) as Partial<CodeData>;
        if (cancelled) return;
        const versions = Array.isArray(d?.versions) ? (d.versions as CodeVersion[]) : [];
        const next: CodeData = {
          edit_targets: Array.isArray(d?.edit_targets) ? (d.edit_targets as string[]) : [],
          unit: typeof d?.unit === "string" ? d.unit : "category",
          current: d?.current && typeof d.current === "object" ? (d.current as Record<string, string>) : {},
          versions,
        };
        setData(next);
        setIdx(versions.length ? versions.length - 1 : 0);
        setUserFile(null);
        const hasCurrent = Object.values(next.current).some((t) => t && t.trim());
        setError(
          versions.length || hasCurrent
            ? null
            : "no code yet (launch a run or a climb first)",
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load code");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeTask]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const versions = data.versions;
  const hasVersions = versions.length > 0;
  const maxIdx = versions.length - 1;
  const cur = hasVersions ? versions[idx] : null;
  const prev = hasVersions && idx > 0 ? versions[idx - 1] : null;
  // The selected version's files, or the live workspace when there is no history.
  const files = cur ? cur.files : data.current;
  const editTargets = data.edit_targets.length
    ? data.edit_targets
    : Object.keys(files);

  // The default open file for the selected version: the one that changed most vs the
  // previous version (ties -> first target); single-file tasks just use that file.
  // Derived during render (not set in an effect); a manual tab click overrides it
  // until the next version change clears userFile.
  const defaultFile = useMemo(() => {
    if (editTargets.length <= 1) return editTargets[0] ?? "";
    let best = editTargets[0];
    let bestN = -1;
    for (const rel of editTargets) {
      let added = 0;
      if (prev) {
        const ps = lineSet(prev.files?.[rel] ?? "");
        for (const l of (files[rel] ?? "").split("\n")) {
          const t = l.trim();
          if (t && !ps.has(t)) added += 1;
        }
      }
      if (added > bestN) {
        bestN = added;
        best = rel;
      }
    }
    return best;
  }, [editTargets, files, prev]);
  const activeFile = userFile ?? defaultFile;

  // Stepping versions clears the manual file override so the new version re-defaults
  // to its most-changed file.
  const go = useCallback((delta: number) => {
    setIdx((i) => Math.max(0, Math.min(maxIdx, i + delta)));
    setUserFile(null);
  }, [maxIdx]);

  const curText = files[activeFile] ?? "";
  // Added-line set vs the previous version of the SAME file (membership, not LCS;
  // matches the skill viewer and reads perfectly for the tokenizer's branch growth).
  const prevSet = useMemo(
    () => lineSet(prev ? (prev.files?.[activeFile] ?? "") : ""),
    [prev, activeFile],
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(720px,94vw)] flex-col border-l border-pass/30 bg-panel/95 backdrop-blur transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
          <div>
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-pass/90">
              workspace code
            </div>
            <div className="mt-0.5 text-sm text-ink-mid">
              the real source the swarm wrote, version by version
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line/60 bg-raised/60 px-2 py-1 text-xs text-ink-mid transition hover:bg-raised/60 hover:text-ink"
          >
            close
          </button>
        </div>

        {hasVersions && (
          <div className="flex items-center gap-2 border-b border-line/70 px-4 py-2.5">
            <button
              onClick={() => go(-1)}
              disabled={idx <= 0}
              className="rounded-md border border-line/60 bg-raised/60 px-2 py-1 text-xs text-ink-mid transition hover:bg-raised/60 disabled:opacity-40"
              aria-label="previous version"
            >
              {"◀"}
            </button>
            <div className="flex flex-wrap items-center gap-1">
              {versions.map((v, i) => (
                <button
                  key={v.version}
                  onClick={() => {
                    setIdx(i);
                    setUserFile(null);
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] tabular-nums transition ${
                    i === idx
                      ? "border border-pass/60 bg-pass/15 text-pass"
                      : "border border-line/70 bg-raised/40 text-ink-dim hover:text-ink-mid"
                  }`}
                >
                  v{v.version}
                </button>
              ))}
            </div>
            <button
              onClick={() => go(1)}
              disabled={idx >= maxIdx}
              className="rounded-md border border-line/60 bg-raised/60 px-2 py-1 text-xs text-ink-mid transition hover:bg-raised/60 disabled:opacity-40"
              aria-label="next version"
            >
              {"▶"}
            </button>
            {cur && cur.accuracy !== undefined && (
              <span className="ml-auto text-[11px] tabular-nums text-ink-mid">
                {(cur.accuracy * 100).toFixed(0)}% correct
              </span>
            )}
          </div>
        )}

        {editTargets.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-line/70 px-4 py-2.5">
            {editTargets.map((rel) => (
              <button
                key={rel}
                onClick={() => setUserFile(rel)}
                title={rel}
                className={`rounded-md px-2 py-1 font-mono text-[11px] transition ${
                  rel === activeFile
                    ? "border border-pass/60 bg-pass/15 text-pass"
                    : "border border-line/70 bg-raised/40 text-ink-dim hover:text-ink-mid"
                }`}
              >
                {baseName(rel)}
              </button>
            ))}
          </div>
        )}

        {!hasVersions && (curText || error === null) && (
          <div className="border-b border-line/70 px-4 py-2 text-[11px] text-ink-dim">
            showing the current code. run a climb to watch it grow version by version.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error && !curText ? (
            <div className="text-xs text-ink-dim">{error}</div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-mid">
              {curText.split("\n").map((line, i) => {
                const t = line.trim();
                const added = prev != null && t.length > 0 && !prevSet.has(t);
                return (
                  <div
                    key={i}
                    className={
                      added
                        ? "-mx-1 rounded-sm border-l-2 border-pass/70 bg-pass/10 px-1 text-pass"
                        : undefined
                    }
                  >
                    {line || " "}
                  </div>
                );
              })}
            </pre>
          )}
        </div>

        <div className="border-t border-line/70 px-4 py-2 text-[10px] text-ink-dim">
          {cur
            ? `source: ${activeFile || "the workspace"} at version ${cur.version} (read live via /api/code)`
            : `source: ${activeFile || "the workspace"}, current (read live via /api/code)`}
        </div>
      </aside>
    </>,
    document.body,
  );
}
