"use client";

// PLANNER SKILL strip: the self-improvement made visible. One tile per scoring
// group of the ACTIVE task (the tokenizer's 7 input categories, or the textkit's 4
// test modules), in the task's canonical climb order, lighting up left to right
// as the planner skill grows. Each still-failing tile shows HOW MANY lines the
// Weave eval flagged (the real, per-run signal the improver prioritizes on); the
// biggest gap pulses red, and the group the improver just added pops green.
// Driven by the board's skill state (the live event stream + /api/skill?task=
// hydrate), so it climbs in lockstep with the correctness curve and is never
// scripted. The group order/colors/labels are task-agnostic: the tile set comes
// from skill.order, and groupColor/groupLabel keep the tokenizer palette while
// deriving stable colors/labels for any other task's groups.

import { useMemo, useState } from "react";

import { groupColor, groupLabel, type SkillState } from "@/lib/cockpit/types";
import { useTaskGroups } from "@/lib/cockpit/useTaskGroups";

import { CollapseButton } from "./CollapseButton";
import { SkillViewerDrawer } from "./SkillViewerDrawer";

export function PlannerSkillPanel({
  skill,
  activeTask,
}: {
  skill: SkillState;
  activeTask: import("@/lib/cockpit/tasks").TaskName;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Collapsed state mirrors the right-rail panels: the panel shrinks to just its
  // header (label, version, coverage) so the board has more room. Defaults open.
  const [open, setOpen] = useState(true);
  // Memoize: skill re-renders on every SSE event; re-creating this Set each time
  // is wasteful since covered changes only when the planner rewrites the skill.
  const covered = useMemo(() => new Set(skill.covered), [skill.covered]);
  // The tile set (order) and group noun (unit) are STATIC per task, sourced keyed
  // on the active task so they always match it (the live skill.order can race a run
  // or a remount). Coverage, failing, version, and accuracy still come from the
  // live skill state below, so the strip keeps climbing in lockstep with the curve.
  const { order, unit } = useTaskGroups(activeTask);
  const total = order.length;
  // A BYO task has no groups until the backend runs its suite once. total === 0
  // means we are still discovering them (curated tasks always have groups).
  const discovering = total === 0;
  const gap = skill.lastGap?.category ?? null;
  const added = skill.lastAdded;
  const failingMap = new Map(skill.failing.map((f) => [f.category, f.failed]));

  const gapCount = skill.lastGap?.failed ?? (gap ? failingMap.get(gap) : undefined);

  let narration: string;
  if (discovering) {
    narration = "discovering test groups from the first run...";
  } else if (added) {
    narration = `rewrote SKILL.md: added a bead for ${added}`;
  } else if (gap) {
    narration = `Weave eval: ${gap} is the biggest gap${
      gapCount ? ` (${gapCount} lines failing)` : ""
    }, rewriting the skill`;
  } else if (total > 0 && covered.size >= total) {
    narration = `full coverage: all ${total} ${unit}s pass the oracle`;
  } else if (skill.failing.length) {
    narration = `eval found gaps, rebuilding the skill one ${unit} at a time`;
  } else {
    narration = `the planner skill grows one ${unit} per Weave eval`;
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
        className="pointer-events-auto cursor-pointer rounded-lg border border-line bg-panel/75 p-3 backdrop-blur transition hover:border-line hover:bg-raised/75"
      >
      <div className={`flex items-center justify-between gap-3 ${open ? "mb-2" : ""}`}>
        <div className="flex items-center gap-2">
          {/* Stop propagation so toggling collapse does not also open the drawer. */}
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <CollapseButton
              open={open}
              onClick={() => setOpen((o) => !o)}
              label="planner skill"
            />
          </span>
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-ink-mid">
            planner skill
          </span>
          <span className="rounded-full border border-line bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-ink-mid">
            v{skill.version}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-ink-dim">
          {covered.size}/{total} covered
          {skill.accuracy !== null
            ? ` · ${(skill.accuracy * 100).toFixed(0)}%`
            : ""}
          <span className="ml-2 text-ink-mid/70">read →</span>
        </span>
      </div>

      {open && (
      <>
      <div className="flex items-stretch gap-1.5">
        {discovering &&
          [0, 1, 2, 3].map((i) => (
            <div
              key={`skeleton-${i}`}
              className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-accent-bright/20 bg-accent-bright/5 px-1 py-2"
              style={{ animation: "gb-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 120}ms` }}
            >
              <span className="h-2 w-2 rounded-full bg-accent-bright/50" />
              <span className="text-[9px] leading-none text-accent-bright/50">...</span>
              <span className="text-[8px] leading-none text-ink-faint">-</span>
            </div>
          ))}
        {!discovering &&
          order.map((cat) => {
          const isCovered = covered.has(cat);
          const isGap = !isCovered && gap === cat;
          const isAdded = added === cat;
          const color = groupColor(cat);
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
                    ? "border-fail/70"
                    : "border-line"
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
                  background: isCovered || isGap ? color : "#26262a",
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
                    ? "text-ink"
                    : isGap
                      ? "text-fail"
                      : "text-ink-dim"
                }`}
              >
                {groupLabel(cat)}
              </span>
              <span
                className={`text-[8px] leading-none tabular-nums ${
                  isCovered
                    ? "text-pass/70"
                    : failed
                      ? "text-fail/80"
                      : "text-ink-faint"
                }`}
              >
                {isCovered ? "pass" : failed ? `${failed} fail` : "-"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 truncate text-[11px] text-ink-mid">
        <span className="text-ink-mid/80">improver</span> {narration}
      </div>
      </>
      )}
    </div>

      <SkillViewerDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeTask={activeTask}
      />
    </>
  );
}
