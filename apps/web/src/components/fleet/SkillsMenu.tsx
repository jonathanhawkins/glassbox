"use client";

// The skills menu: give a worker a capability from skillvault. Lists skill packages
// (search), and "Give" tells the worker to install + use that package's SKILL.md files
// (the worker has shell access, so it does the install itself). The "database of options
// for workers" surface, next to the loop archetypes. It fills the rail's remaining height
// so the list grows with the window (responsive) and scrolls internally, instead of a
// fixed-height box that hid most of the catalog.

import { startTransition, useEffect, useState } from "react";

import { CollapseButton } from "@/components/cockpit/CollapseButton";
import { listPackages, type SkillPackage } from "@/lib/skillvault/client";

export function SkillsMenu({
  onGive,
  disabled,
}: {
  onGive: (p: SkillPackage) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [pkgs, setPkgs] = useState<SkillPackage[]>([]);
  const [err, setErr] = useState("");
  const [sectionOpen, setSectionOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      listPackages(q)
        .then((p) => {
          if (alive) {
            // Rendering the results list is non-urgent: mark it a transition so a
            // burst of typing stays responsive even when a large list reconciles.
            startTransition(() => {
              setPkgs(p);
              setErr("");
            });
          }
        })
        .catch((e) => {
          if (alive) setErr(e instanceof Error ? e.message : "unreachable");
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CollapseButton
            open={sectionOpen}
            onClick={() => setSectionOpen((o) => !o)}
            label="skills"
          />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-dim">
            skills
          </span>
          {pkgs.length > 0 && (
            <span className="rounded-full bg-raised px-1.5 text-[10px] text-ink-dim">
              {pkgs.length}
            </span>
          )}
        </div>
        <span className="text-[10px] text-ink-dim">from skillvault</span>
      </div>
      {sectionOpen && (
        <div className="flex min-h-0 flex-1 flex-col">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search skills (e.g. design, testing, games)"
            spellCheck={false}
            className="mb-2 w-full shrink-0 rounded-lg border border-line bg-canvas/70 px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent/60"
          />
          {err && <p className="shrink-0 text-[11px] text-fail">skillvault: {err}</p>}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
            {pkgs.length === 0 && !err && (
              <p className="text-[11px] text-ink-dim">no skills found.</p>
            )}
            {pkgs.map((p) => (
              <div key={p.id} className="rounded-lg border border-line bg-raised/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">
                      {p.display_name ?? p.name}
                    </div>
                    {p.tagline && (
                      <div className="truncate text-[11px] text-ink-dim">{p.tagline}</div>
                    )}
                    {p.skill_names.length > 0 && (
                      <div className="mt-0.5 truncate text-[10px] text-ink-dim">
                        {p.skill_names.slice(0, 4).join(" · ")}
                        {p.skill_names.length > 4 ? " · …" : ""}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onGive(p)}
                    disabled={disabled}
                    className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-mid transition hover:bg-raised disabled:opacity-40"
                  >
                    Give
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
