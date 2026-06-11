// The loop shapes: the patterns a worker can be wrapped in. This is the teaching
// surface (what each loop is, when to use it) plus the action (a kickoff prompt sent to the
// conductor). Every shape runs the SAME swarm engine, decompose into Claude Tasks
// (beads) -> dispatch each to a sub-agent (Task tool) -> the coordinator verifies for real,
// driven round by round by the loop kernel (lib/voxherd/loop.ts).
//
// What differs between shapes is the STOP CONDITION, so each is named by its motion,
// a single-syllable verb: Land (until verified done), Climb (until the metric plateaus),
// Hold (never, repair drift), Watch (never, digest a stream), Burst (one round),
// Sweep (until the backlog is empty), Dig (until finds run dry), Race (until a judge
// picks the winner). The ids are canonical in contract/glassbox.contract.json
// ("archetypes"), shared with the Python swarm and the board overlays.

import { ARCHETYPE_IDS } from "@glassbox/contract";

export interface Archetype {
  id: string;
  name: string;
  tagline: string; // what it does, one line
  whenToUse: string; // when to reach for it
  stop: string; // the stop condition, one line ("stops when ...")
  accent: string; // tailwind text color
  kickoff: (goal: string) => string; // the prompt that starts this loop on the conductor
}

// The shared engine: the decompose -> dispatch-to-sub-agents -> coordinator-verifies cycle
// that every loop shape runs each round. Prioritizes sub-agents and makes the work visible on
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
    id: "land",
    name: "Land",
    tagline: "Drive to a done-state, then stop.",
    whenToUse: "You have a clear done-state: a feature, a bug fix, an issue to close.",
    stop: "stops when the goal is verified done",
    accent: "text-[#6f9e83]", // sage (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Repeat the cycle until the goal is fully met and the verification passes, then stop.`,
  },
  {
    id: "climb",
    name: "Climb",
    tagline: "Push a metric until it stops improving.",
    whenToUse: "You want it faster, cheaper, or better and there is a number to climb.",
    stop: "stops when you can no longer beat your best",
    accent: "text-[#5e94a8]", // teal (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Each round, push the target metric and measure it. Keep looping while it improves, stop when you can no longer beat your best, and report the numbers.`,
  },
  {
    id: "hold",
    name: "Hold",
    tagline: "Keep an invariant true, repair drift.",
    whenToUse: "Something must stay green: CI, the build, a healthy state.",
    stop: "never stops, repairs whatever drifts",
    accent: "text-[#a88a5c]", // sand (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Treat the goal as an invariant: each round re-check it, dispatch sub-agents to repair anything that drifted, verify it is green again, and keep holding the line.`,
  },
  {
    id: "watch",
    name: "Watch",
    tagline: "Ingest a stream, report a digest each round.",
    whenToUse: "You want a periodic digest: logs, feedback, recent changes.",
    stop: "never stops, reports every round",
    accent: "text-[#9c84a8]", // mauve (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Each round, ingest the latest from the source, dispatch sub-agents to analyze it, and report a concise digest of what is new or notable.`,
  },
  {
    id: "burst",
    name: "Burst",
    tagline: "Fan out once, synthesize, done.",
    whenToUse: "The work splits into parallel parts you want done at once.",
    stop: "runs one round, then stops",
    accent: "text-[#a77e86]", // rosewood (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Fan out now: dispatch all the independent parts to sub-agents at once, then synthesize their results into one outcome as the coordinator. One round, then stop.`,
  },
  {
    id: "sweep",
    name: "Sweep",
    tagline: "Drain a finite backlog, wave by wave.",
    whenToUse: "The work is an enumerable list: a migration, a backfill, a checklist.",
    stop: "stops when the backlog is empty",
    accent: "text-[#90985f]", // olive (muted categorical)
    kickoff: (g) =>
      `${cycle(g)}First, enumerate the COMPLETE backlog: every item the goal implies, registered as its own task up front, so the whole queue is visible before any work starts. Then drain it in waves: dispatch a batch of sub-agents, verify each result, and keep sweeping wave after wave until the backlog is empty, then stop and report the count.`,
  },
  {
    id: "dig",
    name: "Dig",
    tagline: "Discover until the finds run dry.",
    whenToUse: "Open-ended discovery: bug hunts, audits, research.",
    stop: "stops after two rounds with nothing new",
    accent: "text-[#7e8aa2]", // slate (muted categorical)
    kickoff: (g) =>
      `${cycle(g)}Each round, dispatch sub-agents to hunt for NEW findings toward the goal, each digging a different direction. Check every find against what is already recorded and register only the genuinely new ones. Keep digging while rounds keep producing new finds; stop after two consecutive rounds that surface nothing new, and report the full list.`,
  },
  {
    id: "race",
    name: "Race",
    tagline: "Same goal, competing attempts, one judge.",
    whenToUse: "Several approaches could work and you want the best one, proven.",
    stop: "stops when the judge picks a winner",
    accent: "text-[#b06f58]", // clay (muted categorical)
    kickoff: (g) =>
      `${cycle(g)}Run this as a race: dispatch your full allowance of sub-agents on the SAME goal in parallel, each taking a deliberately different approach, with each attempt registered as its own task. When the attempts land, judge them against each other for real (run them, measure, compare), declare exactly ONE winner, record the verdict on every attempt's task, and stop.`,
  },
];

// Dev-time guard on the seam: every shape id must be canonical in
// contract/glassbox.contract.json ("archetypes"), which the Python side and the
// event envelope share. A drifted id would silently break the board overlay.
if (process.env.NODE_ENV !== "production") {
  for (const a of ARCHETYPES) {
    if (!(ARCHETYPE_IDS as readonly string[]).includes(a.id)) {
      console.warn(`archetype id "${a.id}" is not in the contract's archetypes list`);
    }
  }
}
