"use client";

// The loop-archetype rail: pick a loop pattern to run on this worker. Teaches what each
// loop is (tagline + when-to-use) and fires it via a kickoff prompt. This is the "use
// the archetypes to know what loops you can do" surface.

import { useState } from "react";

import { CollapseButton } from "@/components/cockpit/CollapseButton";
import { ARCHETYPES, type Archetype } from "@/lib/fleet/archetypes";

export function ArchetypeRail({
  onRun,
  disabled,
  goal: goalProp,
}: {
  onRun: (a: Archetype, goal: string) => void;
  disabled?: boolean;
  // When provided, the rail is controlled by a shared goal (header) and hides its own input.
  goal?: string;
}) {
  const [goalState, setGoalState] = useState("");
  const [open, setOpen] = useState("");
  const [sectionOpen, setSectionOpen] = useState(true);
  const controlled = goalProp !== undefined;
  const goal = controlled ? goalProp : goalState;
  // Once a goal exists the rail comes alive: the Run buttons light up so it is obvious you can
  // fire a loop now. No instruction copy, the UI shows readiness.
  const ready = !disabled && goal.trim().length > 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CollapseButton
            open={sectionOpen}
            onClick={() => setSectionOpen((o) => !o)}
            label="loop archetypes"
          />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-dim">
            loop archetypes
          </span>
        </div>
        <span className="text-[10px] text-ink-dim">what loop should this worker run?</span>
      </div>
      {sectionOpen && (
        <>
      {!controlled && (
        <input
          value={goalState}
          onChange={(e) => setGoalState(e.target.value)}
          placeholder="goal for the loop (e.g. close issue #42, make X faster)"
          spellCheck={false}
          className={`mb-2 w-full rounded-lg border bg-panel/70 px-3 py-1.5 text-xs text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-accent/60 ${
            goalState.trim() ? "border-accent/40" : "border-line"
          }`}
        />
      )}
      <div className="flex flex-col gap-1.5">
        {ARCHETYPES.map((a) => (
          <div key={a.id} className="rounded-lg border border-line bg-panel/40 p-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setOpen(open === a.id ? "" : a.id)}
                className="min-w-0 text-left"
              >
                <span className={`text-sm font-semibold ${a.accent}`}>{a.name}</span>
                <span className="ml-2 text-[11px] text-ink-dim">{a.tagline}</span>
              </button>
              <button
                type="button"
                onClick={() => onRun(a, goal)}
                disabled={disabled || !goal.trim()}
                className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${
                  ready
                    ? "border-accent/50 bg-accent/15 text-accent hover:bg-accent/25"
                    : "border-line text-ink-dim hover:bg-raised hover:text-ink"
                }`}
              >
                Run
              </button>
            </div>
            {open === a.id && (
              <p className="mt-1 text-[11px] text-ink-dim">When to use: {a.whenToUse}</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-ink-dim">
        Run drives the loop on the conductor: decompose into tasks &rarr; dispatch to sub-agents
        &rarr; the coordinator verifies &rarr; repeat until the archetype&apos;s stop condition.
      </p>
        </>
      )}
    </div>
  );
}
