// The loop archetypes: the patterns a worker can be wrapped in. This is the teaching
// surface (what each loop is, when to use it) plus the action (a kickoff prompt sent to the
// conductor). Every archetype runs the SAME swarm engine, decompose into Claude Tasks
// (beads) -> dispatch each to a sub-agent (Task tool) -> the coordinator verifies for real,
// driven round by round by the loop kernel (lib/voxherd/loop.ts). The archetypes differ only
// in how the goal is framed and when the loop terminates.

export interface Archetype {
  id: string;
  name: string;
  tagline: string; // what it does, one line
  whenToUse: string; // when to reach for it
  accent: string; // tailwind text color
  kickoff: (goal: string) => string; // the prompt that starts this loop on the conductor
}

// The shared engine: the decompose -> dispatch-to-sub-agents -> coordinator-verifies cycle
// that every archetype runs each round. Prioritizes sub-agents and makes the work visible on
// the board (each TaskCreate is a bead; each sub-agent is a worker).
const cycle = (goal: string) =>
  `You are the CONDUCTOR of an agent swarm. Goal:\n${goal}\n\n` +
  `Run this cycle each round, and make it visible on the board:\n` +
  `1) DECOMPOSE: for each unit of remaining work, FIRST call TaskCreate to register it. This is REQUIRED, the TaskCreate entries are exactly what render as beads on the board, so create every task up front before starting any of them.\n` +
  `2) DISPATCH: then spawn a sub-agent with the Task tool for each registered task, working them in parallel (prefer sub-agents over doing the work yourself), and mark each task in_progress as its sub-agent starts.\n` +
  `3) VERIFY + RECORD: as the coordinator, check each result for real (run the tests, or open and ` +
  `check the actual behavior). Before you mark a task completed, TaskUpdate its description with a ` +
  `concise RESULT of what the sub-agent actually produced or changed. This is REQUIRED: the task ` +
  `list is the only thing that PERSISTS, so recording the result there is what lets the user click ` +
  `the bead and see what happened AFTER the run, instead of it scrolling away. Re-open a task with ` +
  `what is still wrong if it fails.\n`;

export const ARCHETYPES: Archetype[] = [
  {
    id: "converge",
    name: "Converge",
    tagline: "Iterate until a defined goal is met.",
    whenToUse: "You have a clear done-state: a feature, a bug fix, an issue to close.",
    accent: "text-[#6f9e83]", // sage (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Repeat the cycle until the goal is fully met and the verification passes, then stop.`,
  },
  {
    id: "optimize",
    name: "Optimize",
    tagline: "Push a metric until it stops improving.",
    whenToUse: "You want it faster, cheaper, or better and there is a number to climb.",
    accent: "text-[#5e94a8]", // teal (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Each round, push the target metric and measure it. Keep looping while it improves, stop when you can no longer beat your best, and report the numbers.`,
  },
  {
    id: "watchdog",
    name: "Watchdog",
    tagline: "Keep an invariant true, repair drift.",
    whenToUse: "Something must stay green: CI, the build, a healthy state.",
    accent: "text-[#a88a5c]", // sand (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Treat the goal as an invariant: each round re-check it, dispatch sub-agents to repair anything that drifted, verify it is green again, and keep watching.`,
  },
  {
    id: "monitor",
    name: "Monitor",
    tagline: "Ingest a stream, summarize, report.",
    whenToUse: "You want a periodic digest: logs, feedback, recent changes.",
    accent: "text-[#9c84a8]", // mauve (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Each round, ingest the latest from the source, dispatch sub-agents to analyze it, and report a concise digest of what is new or notable.`,
  },
  {
    id: "coordinate",
    name: "Coordinate",
    tagline: "Fan out across sub-agents, then synthesize.",
    whenToUse: "The work splits into parallel parts you want done at once.",
    accent: "text-[#a77e86]", // rosewood (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Fan out now: dispatch all the independent parts to sub-agents at once, then synthesize their results into one outcome as the coordinator.`,
  },
];
