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
  detail: string; // what actually happens round to round, in plain words (the info panel)
  whenToUse: string; // when to reach for it
  example: string; // a concrete goal + what the loop does with it (the info panel)
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
    detail:
      "The swarm breaks the goal into tasks, works them in parallel, and verifies each result for real. If verification fails, the next round attacks what is still wrong. It only stops once the goal actually checks out.",
    whenToUse: "You have a clear done-state: a feature, a bug fix, an issue to close.",
    example:
      '"Fix the flaky auth test and close issue #42." The swarm keeps fixing and re-verifying until the test really passes, then lands.',
    stop: "stops when the goal is verified done",
    accent: "text-[#6f9e83]", // sage (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Repeat the cycle until the goal is fully met and the verification passes, then stop.`,
  },
  {
    id: "climb",
    name: "Climb",
    tagline: "Push a metric until it stops improving.",
    detail:
      "Every round is an attempt to beat the current best number: make a change, measure it, keep it if it improved. When a round cannot beat the best, the climb is over and it reports the curve.",
    whenToUse: "You want it faster, cheaper, or better and there is a number to climb.",
    example:
      '"Make tokenizer encode() faster." Each round tries an optimization and benchmarks it, stopping once a round cannot beat the best time.',
    stop: "stops when you can no longer beat your best",
    accent: "text-[#5e94a8]", // teal (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Each round, push the target metric and measure it. Keep looping while it improves, stop when you can no longer beat your best, and report the numbers.`,
  },
  {
    id: "hold",
    name: "Hold",
    tagline: "Keep an invariant true, repair drift.",
    detail:
      "A standing guard. Each round it re-checks the invariant. If anything drifted, it dispatches repairs and verifies the fix landed. It never declares done, it holds the line.",
    whenToUse: "Something must stay green: CI, the build, a healthy state.",
    example:
      '"Keep CI green on main." Whenever a check breaks, it repairs the break, confirms green, and goes back to standing guard.',
    stop: "never stops, repairs whatever drifts",
    accent: "text-[#a88a5c]", // sand (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Treat the goal as an invariant: each round re-check it, dispatch sub-agents to repair anything that drifted, verify it is green again, and keep holding the line.`,
  },
  {
    id: "watch",
    name: "Watch",
    tagline: "Ingest a stream, report a digest each round.",
    detail:
      "A standing lookout. Each round it pulls whatever is new from the source, has sub-agents analyze it, and posts a short digest. It never declares done, it keeps watching.",
    whenToUse: "You want a periodic digest: logs, feedback, recent changes.",
    example:
      '"Watch the error logs." Every round it reads the new entries and reports a digest of anything notable since the last round.',
    stop: "never stops, reports every round",
    accent: "text-[#9c84a8]", // mauve (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Each round, ingest the latest from the source, dispatch sub-agents to analyze it, and report a concise digest of what is new or notable.`,
  },
  {
    id: "burst",
    name: "Burst",
    tagline: "Fan out once, synthesize, done.",
    detail:
      "One parallel blast. All the independent parts go to sub-agents at the same time, then the conductor merges their results into a single outcome. There is no second round.",
    whenToUse: "The work splits into parallel parts you want done at once.",
    example:
      '"Review this PR for security, performance, and test coverage." Three reviewers run at once and the findings come back as one report.',
    stop: "runs one round, then stops",
    accent: "text-[#a77e86]", // rosewood (muted categorical, user-chosen)
    kickoff: (g) =>
      `${cycle(g)}Fan out now: dispatch all the independent parts to sub-agents at once, then synthesize their results into one outcome as the coordinator. One round, then stop.`,
  },
  {
    id: "sweep",
    name: "Sweep",
    tagline: "Drain a finite backlog, wave by wave.",
    detail:
      "First it enumerates the whole backlog up front, so the full queue is visible before any work starts. Then it drains the queue in parallel waves, verifying each item, until nothing is left.",
    whenToUse: "The work is an enumerable list: a migration, a backfill, a checklist.",
    example:
      '"Migrate all 60 call sites off the deprecated API." All 60 appear as tasks first, then waves of workers drain the list to zero.',
    stop: "stops when the backlog is empty",
    accent: "text-[#90985f]", // olive (muted categorical)
    kickoff: (g) =>
      `${cycle(g)}First, enumerate the COMPLETE backlog: every item the goal implies, registered as its own task up front, so the whole queue is visible before any work starts. Then drain it in waves: dispatch a batch of sub-agents, verify each result, and keep sweeping wave after wave until the backlog is empty, then stop and report the count.`,
  },
  {
    id: "dig",
    name: "Dig",
    tagline: "Discover until the finds run dry.",
    detail:
      "Rounds of hunters, each digging in a different direction, with every find checked against what is already recorded so only genuinely new ones count. Productive rounds keep it digging; two empty rounds in a row end it.",
    whenToUse: "Open-ended discovery: bug hunts, audits, research.",
    example:
      '"Audit the codebase for race conditions." Hunters keep surfacing new finds until two rounds come up empty, then it reports the full list.',
    stop: "stops after two rounds with nothing new",
    accent: "text-[#7e8aa2]", // slate (muted categorical)
    kickoff: (g) =>
      `${cycle(g)}Each round, dispatch sub-agents to hunt for NEW findings toward the goal, each digging a different direction. Check every find against what is already recorded and register only the genuinely new ones. Keep digging while rounds keep producing new finds; stop after two consecutive rounds that surface nothing new, and report the full list.`,
  },
  {
    id: "race",
    name: "Race",
    tagline: "Same goal, competing attempts, one judge.",
    detail:
      "Several sub-agents attack the same goal with deliberately different approaches. When the attempts land, a judge runs and compares them for real (measure, not vibes) and declares exactly one winner.",
    whenToUse: "Several approaches could work and you want the best one, proven.",
    example:
      '"Speed up the parser, best approach wins." Three strategies run head to head, the judge benchmarks all three, and one winner ships.',
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
