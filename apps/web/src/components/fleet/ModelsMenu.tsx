"use client";

// The per-role model + effort picker for the real swarm: a compact "models" button in the
// header that opens a 5-row grid (planner / coordinator / workers / validator / improver),
// each row a model select + an effort select with the role's lane color for the visual tie
// to the board. Applied when "+ real swarm" spawns the sessions (/model + /effort are typed
// into each fresh session before its role prompt); persisted so it is set once.

import { useEffect, useRef, useState } from "react";

import { agentColor } from "@/lib/cockpit/types";
import {
  DEFAULT_SWARM_MODELS,
  MODEL_CHOICES,
  ROLE_ROWS,
  assistantOf,
  coerceEffort,
  effortsFor,
  modelLabel,
  type Assistant,
  type RoleKey,
  type SwarmModels,
} from "@/lib/voxherd/role-models";

// Model options grouped by brain so the operator sees, and the <optgroup> labels make clear,
// which rows run on Claude vs Codex. The effort dropdown then offers only the chosen brain's
// valid levels (Claude low..max, Codex minimal..xhigh).
const MODEL_GROUPS: { label: string; assistant: Assistant }[] = [
  { label: "Claude", assistant: "claude" },
  { label: "Codex", assistant: "codex" },
];

const SELECT_CLS =
  "rounded-md border border-line bg-canvas/70 px-1.5 py-1 text-[11px] text-ink outline-none transition-colors focus:border-accent/60";

export function ModelsMenu({
  value,
  onChange,
  workers,
}: {
  value: SwarmModels;
  onChange: (m: SwarmModels) => void;
  workers: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click (same pattern as the conductor picker).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Changing the model can switch brains, so re-clamp the effort to the new brain's valid set
  // (e.g. Claude "max" -> Codex "xhigh"); changing the effort just stores the (already valid) level.
  const setModel = (key: RoleKey, model: string) =>
    onChange({ ...value, [key]: { model, effort: coerceEffort(assistantOf(model), value[key].effort) } });
  const setEffort = (key: RoleKey, effort: string) =>
    onChange({ ...value, [key]: { ...value[key], effort } });

  const customized = JSON.stringify(value) !== JSON.stringify(DEFAULT_SWARM_MODELS);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`model + effort per spawned role (workers: ${modelLabel(value.worker.model)} · ${value.worker.effort})`}
        className={`rounded-md border bg-canvas/70 px-2 py-1 text-xs outline-none transition ${
          customized
            ? "border-accent/40 text-accent hover:bg-accent/10"
            : "border-line text-ink-dim hover:text-ink"
        }`}
      >
        models
      </button>
      {open && (
        // left-0: open rightwards from the button, over the canvas, instead of extending left
        // into the conductor console's column.
        <div className="absolute left-0 top-full z-30 mt-2 w-[310px] rounded-xl border border-line bg-raised/95 p-3 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-dim">
              models + effort
            </span>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_SWARM_MODELS)}
              disabled={!customized}
              className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim transition hover:text-ink disabled:opacity-40"
              title="restore the defaults"
            >
              reset
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1.5">
            {ROLE_ROWS.map((row) => (
              <div key={row.key} className="contents">
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-ink-mid">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: agentColor(row.agent) }}
                  />
                  <span className="truncate">
                    {row.label}
                    {row.key === "worker" && (
                      <span className="text-ink-dim"> &times;{workers}</span>
                    )}
                  </span>
                </span>
                <select
                  value={value[row.key].model}
                  onChange={(e) => setModel(row.key, e.target.value)}
                  className={SELECT_CLS}
                  title={`${row.label} model`}
                >
                  {MODEL_GROUPS.map((g) => (
                    <optgroup key={g.assistant} label={g.label}>
                      {MODEL_CHOICES.filter((m) => m.assistant === g.assistant).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <select
                  value={value[row.key].effort}
                  onChange={(e) => setEffort(row.key, e.target.value)}
                  className={SELECT_CLS}
                  title={`${row.label} effort`}
                >
                  {effortsFor(assistantOf(value[row.key].model)).map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
            Applied when <span className="text-accent">+ real swarm</span> spawns the sessions:
            Claude roles get /model and /effort before the role prompt; Codex roles launch on
            their model and reasoning effort. Saved for next time.
          </p>
        </div>
      )}
    </div>
  );
}
