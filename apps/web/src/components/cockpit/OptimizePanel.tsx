"use client";

// The optimize mode made visible: the ideator's proposals streaming in, each marked
// kept (a grader-verified speedup) or dropped, with the best speedup so far up top and
// a "converged" note once it is genuinely stuck. Driven by the same event list the
// cockpit already collects: optimize_loop emits plan_gap_found for each new idea and
// validation_passed / validation_failed for the grader's verdict (both carry the idea
// and the running metric in their payload).

import { useMemo, useState } from "react";

import type { GlassboxEvent } from "@glassbox/contract";
import { CollapseButton } from "./CollapseButton";

type Idea = { idea: string; kept: boolean; metric: number; ts: number };

function payloadNum(ev: GlassboxEvent, key: string): number {
  const v = (ev.payload as Record<string, unknown> | undefined)?.[key];
  return typeof v === "number" ? v : 0;
}

function payloadStr(ev: GlassboxEvent, key: string): string {
  const v = (ev.payload as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : "";
}

export function OptimizePanel({ events }: { events: GlassboxEvent[] }) {
  const { ideas, best, stuck } = useMemo(() => {
    const trail: Idea[] = [];
    let top = 0;
    let converged = false;
    // events arrive newest-first; walk oldest-first (backward, in place) for a
    // natural top-to-bottom trail without copying the array every event.
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      const idea = payloadStr(ev, "idea");
      if (ev.type === "validation_passed" && idea) {
        const metric = payloadNum(ev, "metric");
        trail.push({ idea, kept: true, metric, ts: ev.ts });
        if (metric > top) top = metric;
      } else if (ev.type === "validation_failed" && idea) {
        trail.push({ idea, kept: false, metric: payloadNum(ev, "metric"), ts: ev.ts });
      } else if (
        ev.type === "run_finished" &&
        (ev.payload as Record<string, unknown> | undefined)?.stuck
      ) {
        converged = true;
      }
    }
    return { ideas: trail.slice(-30), best: top, stuck: converged };
  }, [events]);

  const [open, setOpen] = useState(true);

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex shrink-0 items-center gap-2">
        <CollapseButton open={open} onClick={() => setOpen((o) => !o)} label="optimize ideas" />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mid">
          optimize ideas
        </span>
        {best > 0 && (
          <span className="ml-auto text-[11px] font-semibold tabular-nums text-pass">
            best {best.toFixed(2)}x
          </span>
        )}
      </div>
      {!open ? null : ideas.length === 0 ? (
        <span className="text-[11px] text-ink-dim">no optimization run yet</span>
      ) : (
        <div className="flex max-h-[150px] flex-col gap-1 overflow-y-auto pr-1">
          {ideas.map((it) => (
            <div
              key={`${it.ts}-${it.kept ? "k" : "d"}-${it.idea}`}
              className="flex items-start gap-2 text-[11px] leading-tight"
            >
              <span className={it.kept ? "text-pass" : "text-ink-dim"}>
                {it.kept ? "✓" : "·"}
              </span>
              <span className="flex-1 text-ink-mid">
                {it.idea}
                {it.kept && (
                  <span className="ml-1 font-medium text-pass">
                    {it.metric.toFixed(2)}x
                  </span>
                )}
              </span>
            </div>
          ))}
          {stuck && (
            <div className="mt-1 text-[11px] font-medium text-ink-dim">
              converged: out of ideas that beat {best.toFixed(2)}x
            </div>
          )}
        </div>
      )}
    </div>
  );
}
