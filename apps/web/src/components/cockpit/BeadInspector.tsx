"use client";

// A small task-inspector popover. When an operator clicks a bead on the board,
// the cockpit resolves its live detail (see BoardController.beadDetail) and shows
// this card near the click: which task it is, its category, its lifecycle state,
// and the worker currently holding it. Dismissed by clicking the backdrop or Esc.

import { useEffect } from "react";

import {
  AGENT_ROLES,
  agentColor,
  capColor,
  groupLabel,
  type BeadDetail,
  type BeadState,
} from "@/lib/cockpit/types";

// Human label + accent color per lifecycle state, matching the board's bead ring.
const STATE_META: Record<BeadState, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#a1a1a6" },
  claimed: { label: "Claimed", color: "#ff6a1a" },
  working: { label: "In progress", color: "#ff6a1a" },
  done: { label: "Done, validating", color: "#9aa0a6" },
  passed: { label: "Passed the oracle", color: "#5ba372" },
  failed: { label: "Failed, retrying", color: "#d85a52" },
  injected: { label: "Injected gap fill", color: "#ff8a3d" },
};

// Popover footprint, used to clamp it inside the viewport near the click point.
const CARD_W = 300;
const CARD_H = 240;
const GAP = 14;

export type InspectState = { detail: BeadDetail; x: number; y: number };

export function BeadInspector({
  inspect,
  onClose,
}: {
  inspect: InspectState | null;
  onClose: () => void;
}) {
  // Close on Escape while the popover is open.
  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect, onClose]);

  if (!inspect) return null;
  const { detail, x, y } = inspect;
  const { beadId, label, title, capability, state, worker } = detail;

  const cap = capColor(capability);
  const sm = STATE_META[state] ?? STATE_META.backlog;
  const workerRole = worker ? AGENT_ROLES[worker] ?? "implement" : null;

  // Anchor the card just below-right of the click, clamped to the viewport so it
  // never spills off-screen on edge clicks.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(GAP, Math.min(x + GAP, vw - CARD_W - GAP));
  const top = Math.max(GAP, Math.min(y + GAP, vh - CARD_H - GAP));

  return (
    <>
      {/* Transparent backdrop: a click anywhere off the card dismisses it. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={`Task ${label}`}
        className="fixed z-50 w-[300px] overflow-hidden rounded-lg border border-line bg-panel/95 shadow-2xl backdrop-blur"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: capability dot + chip id, with a state badge and close. */}
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: cap, boxShadow: `0 0 8px ${cap}` }}
            />
            <span className="truncate font-mono text-sm font-semibold text-ink">
              {label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="-mr-1 -mt-0.5 shrink-0 rounded-md px-1.5 text-ink-dim transition-colors hover:bg-raised hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          {/* What the task is. */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">
              task
            </div>
            <p className="mt-1 text-sm leading-snug text-ink">
              {title || "(no description)"}
            </p>
          </div>

          {/* State badge. */}
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{
                borderColor: `${sm.color}66`,
                background: `${sm.color}1a`,
                color: sm.color,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: sm.color }}
              />
              {sm.label}
            </span>
          </div>

          {/* Metadata rows. */}
          <dl className="space-y-1.5 text-xs">
            <Row term="category">
              <span className="font-mono" style={{ color: cap }}>
                {groupLabel(capability) || "unknown"}
              </span>
            </Row>
            <Row term="assigned">
              {worker ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: agentColor(worker) }}
                  />
                  <span className="text-ink">{worker}</span>
                  <span className="text-ink-dim">({workerRole})</span>
                </span>
              ) : (
                <span className="text-ink-dim">unclaimed</span>
              )}
            </Row>
            <Row term="bead id">
              <span className="break-all font-mono text-ink-dim">{beadId}</span>
            </Row>
          </dl>
        </div>
      </div>
    </>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">
        {term}
      </dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
