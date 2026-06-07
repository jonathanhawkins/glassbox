"use client";

// PLANNER SKILL strip: the self-improvement made visible. Seven capability tiles
// (one per scoring category, in canonical climb order) light up left to right as
// the planner skill grows. Each still-failing tile shows HOW MANY lines the Weave
// eval flagged (the real, per-run signal the improver prioritizes on); the
// biggest gap pulses red, and the category the improver just added pops green.
// Driven by the board's skill state (the live event stream + /api/skill hydrate),
// so it climbs in lockstep with the correctness curve and is never scripted.

import { useState } from "react";

import {
  CAP_COLORS,
  CAP_LABELS,
  CATEGORY_ORDER,
  type Capability,
  type SkillState,
} from "@/lib/cockpit/types";

import { SkillViewerDrawer } from "./SkillViewerDrawer";

export function PlannerSkillPanel({ skill }: { skill: SkillState }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const covered = new Set(skill.covered);
  const total = CATEGORY_ORDER.length;
  const gap = skill.lastGap?.category ?? null;
  const added = skill.lastAdded;
  const failingMap = new Map(skill.failing.map((f) => [f.category, f.failed]));

  const gapCount = skill.lastGap?.failed ?? (gap ? failingMap.get(gap) : undefined);

  let narration: string;
  if (added) {
    narration = `rewrote SKILL.md: added a bead for ${added}`;
  } else if (gap) {
    narration = `Weave eval: ${gap} is the biggest gap${
      gapCount ? ` (${gapCount} lines failing)` : ""
    }, rewriting the skill`;
  } else if (covered.size >= total) {
    narration = "full coverage: all 7 input categories pass the oracle";
  } else if (skill.failing.length) {
    narration = "eval found gaps, rebuilding the skill one category at a time";
  } else {
    narration = "the planner skill grows one category per Weave eval";
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setDrawerOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDrawerOpen(true);
          }
        }}
        title="Open the planner skill: read it and step through every version"
        className="pointer-events-auto cursor-pointer rounded-2xl border border-violet-500/30 bg-slate-950/75 p-3 backdrop-blur transition hover:border-violet-400/60 hover:bg-slate-900/75"
      >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-violet-300/90">
            planner skill
          </span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] tabular-nums text-violet-200">
            v{skill.version}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-slate-500">
          {covered.size}/{total} covered
          {skill.accuracy !== null
            ? ` · ${(skill.accuracy * 100).toFixed(0)}%`
            : ""}
          <span className="ml-2 text-violet-300/70">read →</span>
        </span>
      </div>

      <div className="flex items-stretch gap-1.5">
        {CATEGORY_ORDER.map((cat) => {
          const isCovered = covered.has(cat);
          const isGap = !isCovered && gap === cat;
          const isAdded = added === cat;
          const color = CAP_COLORS[cat as Capability];
          const failed = !isCovered ? failingMap.get(cat) : undefined;
          return (
            <div
              key={cat}
              title={`${cat}: ${
                isCovered ? "covered" : `${failed ?? 0} lines failing`
              }`}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 transition-all duration-500 ${
                isCovered
                  ? "border-transparent"
                  : isGap
                    ? "border-rose-500/70"
                    : "border-slate-800/70"
              }`}
              style={
                isCovered
                  ? {
                      background: `${color}22`,
                      borderColor: `${color}66`,
                      boxShadow: `0 0 10px ${color}33`,
                    }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: isCovered || isGap ? color : "#334155",
                  boxShadow: isCovered ? `0 0 6px ${color}` : undefined,
                  animation: isGap
                    ? "gb-pulse 1.1s ease-in-out infinite"
                    : isAdded
                      ? "gb-pop 600ms ease-out"
                      : undefined,
                }}
              />
              <span
                className={`text-[9px] leading-none ${
                  isCovered
                    ? "text-slate-200"
                    : isGap
                      ? "text-rose-300"
                      : "text-slate-500"
                }`}
              >
                {CAP_LABELS[cat as Capability]}
              </span>
              <span
                className={`text-[8px] leading-none tabular-nums ${
                  isCovered
                    ? "text-emerald-400/70"
                    : failed
                      ? "text-rose-400/80"
                      : "text-slate-700"
                }`}
              >
                {isCovered ? "pass" : failed ? `${failed} fail` : "-"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 truncate text-[11px] text-slate-400">
        <span className="text-violet-300/80">improver</span> {narration}
      </div>
    </div>

      <SkillViewerDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
