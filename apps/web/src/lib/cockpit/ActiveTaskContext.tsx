"use client";

// The active build target, shared with deeply-nested consumers that cannot take
// it as a prop. The launch controls, the curve, and the planner-skill strip all
// receive activeTask directly from CockpitBoard, but the in-chat generative-UI
// charts are rendered by CopilotKit's tool render() callbacks (CopilotActions ->
// ChatCharts), which the cockpit cannot prop-drill into. Those read the active
// task from this context instead, so the chat curve/leaderboard match whichever
// task the operator is running. Defaults to the tokenizer so a render outside the
// provider still works.

import { createContext, useContext } from "react";

import { DEFAULT_TASK, type TaskName } from "./tasks";

const ActiveTaskContext = createContext<TaskName>(DEFAULT_TASK);

export const ActiveTaskProvider = ActiveTaskContext.Provider;

export function useActiveTask(): TaskName {
  return useContext(ActiveTaskContext);
}
