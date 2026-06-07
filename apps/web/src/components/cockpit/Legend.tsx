"use client";

// Color legend for the ACTIVE task's scoring groups. Mirrors the PLANNER SKILL
// strip: the group list comes from the active task (useTaskGroups) and the colors
// and labels from the task-agnostic groupColor/groupLabel, so the legend is the
// live color key for whichever task is running (the tokenizer's categories or the
// textkit's modules), matching the bead colors on the board.

import { groupColor, groupLabel } from "@/lib/cockpit/types";
import type { TaskName } from "@/lib/cockpit/tasks";
import { useTaskGroups } from "@/lib/cockpit/useTaskGroups";

export function Legend({ activeTask }: { activeTask: TaskName }) {
  const { order } = useTaskGroups(activeTask);
  if (order.length === 0) {
    // BYO task still discovering its groups (or a backend outage): show a muted
    // placeholder instead of an empty, invisible legend.
    return (
      <span className="text-[10px] tracking-wide text-slate-500">
        groups appear after the first eval
      </span>
    );
  }
  return (
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
  );
}
