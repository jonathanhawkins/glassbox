"use client";

// The loop-shapes rail: pick a loop shape to run on this worker. Teaches what each
// loop is (tagline, with an info icon expanding detail + when-to-use + example + stop
// condition) and fires it via a kickoff prompt.
// "Shapes" is literal: the board draws a different return edge per shape, so the rail
// name and the graph teach the same idea.

import { useState } from "react";

import { CollapseButton } from "@/components/cockpit/CollapseButton";
import { ARCHETYPES, type Archetype } from "@/lib/fleet/archetypes";
import { usePersistentState } from "@/lib/usePersistentState";

export function ArchetypeRail({
  onRun,
  disabled,
  goal: goalProp,
  defaultOpen = true,
  persistKey,
}: {
  onRun: (a: Archetype, goal: string) => void;
  disabled?: boolean;
  // When provided, the rail is controlled by a shared goal (header) and hides its own input.
  goal?: string;
  // Start the shapes list collapsed where the rail shares space with other panels (the swarm
  // rail puts the activity log below it, so loop shapes folds away to give the log room).
  defaultOpen?: boolean;
  // When provided, the collapse state persists under this localStorage key (the swarm rail
  // remembers it across refreshes); omitted, it is per-mount state as before.
  persistKey?: string;
}) {
  const [goalState, setGoalState] = useState("");
  const [open, setOpen] = useState("");
  const [sectionOpen, setSectionOpen] = usePersistentState(persistKey ?? null, defaultOpen);
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
            label="loop shapes"
          />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-dim">
            loop shapes
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
              <div className="flex min-w-0 items-center gap-1">
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
                  onClick={() => setOpen(open === a.id ? "" : a.id)}
                  aria-label={`What does the ${a.name} loop do?`}
                  aria-expanded={open === a.id}
                  title={`What does the ${a.name} loop do?`}
                  className={`shrink-0 rounded-full p-0.5 transition-colors ${
                    open === a.id ? "text-accent" : "text-ink-dim/70 hover:text-ink"
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.2" />
                    <circle cx="8" cy="5.2" r="0.95" fill="currentColor" />
                    <path
                      d="M8 7.4v3.8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
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
              <div className="mt-1.5 space-y-1 border-t border-line pt-1.5 text-[11px] leading-relaxed text-ink-dim">
                <p>{a.detail}</p>
                <p>
                  <span className="font-medium text-ink">When to use:</span> {a.whenToUse}
                </p>
                <p>
                  <span className="font-medium text-ink">Example:</span> {a.example}
                </p>
                <p>
                  <span className="font-medium text-ink">Stops:</span> this loop {a.stop}.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-ink-dim">
        Run drives the loop on the conductor: decompose into tasks &rarr; dispatch to sub-agents
        &rarr; the coordinator verifies &rarr; repeat until the shape&apos;s stop condition. The
        board redraws the return edge to match.
      </p>
        </>
      )}
    </div>
  );
}
