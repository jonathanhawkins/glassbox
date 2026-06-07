"use client";

// Color legend for the ACTIVE task's scoring groups. Mirrors the PLANNER SKILL
// strip: the group list comes from the active task (useTaskGroups) and the colors
// and labels from the task-agnostic groupColor/groupLabel, so the legend is the
// live color key for whichever task is running (the tokenizer's categories or the
// textkit's modules), matching the bead colors on the board. Sits at the foot of
// the right rail and collapses to its header so the event feed has room.

import { useState } from "react";

import { groupColor, groupLabel } from "@/lib/cockpit/types";
import type { TaskName } from "@/lib/cockpit/tasks";
import { useTaskGroups } from "@/lib/cockpit/useTaskGroups";
import { CollapseButton } from "./CollapseButton";

export function Legend({ activeTask }: { activeTask: TaskName }) {
  const { order } = useTaskGroups(activeTask);
  const [open, setOpen] = useState(true);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <CollapseButton open={open} onClick={() => setOpen((o) => !o)} label="legend" />
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
          legend
        </span>
      </div>
      {open &&
        (order.length === 0 ? (
          // BYO task still discovering its groups (or a backend outage): show a
          // muted placeholder instead of an empty, invisible legend.
          <span className="text-[10px] tracking-wide text-slate-500">
            groups appear after the first eval
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {order.map((group) => {
              const color = groupColor(group);
              return (
                <span key={group} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                  />
                  <span className="text-[10px] tracking-wide text-slate-400">
                    {groupLabel(group)}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
    </div>
  );
}
