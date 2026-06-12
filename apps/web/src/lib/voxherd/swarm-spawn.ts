// Phase B: spawn a REAL swarm. Dedicated voxherd Claude sessions (validator, improver, N
// workers) that genuinely coordinate, NO mocking. The coordination channels are real and
// already available to every spawned session:
//   - Agent Mail (the mcp-agent-mail tools, configured globally in ~/.claude.json): identities,
//     messages between agents, and file leases.
//   - The shared task list (the bridge sets CLAUDE_CODE_TASK_LIST_ID=voxherd on every spawn),
//     surfaced on the board via /api/tasks.
//   - Real tests via Bash for validation (and Chrome/computer-use if those tools are present).
// Returns a node-name -> session_id map so the board can stream each node's OWN live terminal.

import { spawnSession } from "./ws";
import { fetchSessions, renameSession, sendCommand } from "./client";
import { roleKeyOf, type SwarmModels } from "./role-models";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const intro = (goal: string, role: string) =>
  `You are ${role} in a LIVE multi-agent swarm. Goal:\n\n${goal}\n\n` +
  `This is a real swarm of separate Claude sessions. Coordinate for real, never simulate or ` +
  `claim results you did not produce:\n` +
  `- Use the Agent Mail tools (mcp-agent-mail): register your identity once, send messages to ` +
  `teammates (conductor, workers, validator, improver), and poll your inbox each loop.\n` +
  `- Use the shared task list (TaskCreate / TaskUpdate) for work items so progress shows on the ` +
  `board.\n\n`;

function plannerPrompt(goal: string): string {
  return (
    intro(goal, "the PLANNER") +
    `You PLAN, you do not implement. Decompose the goal into a clear, ordered set of concrete ` +
    `tasks with TaskCreate (each becomes a bead), then Agent-mail the coordinator the plan so it ` +
    `can hand the work out. Re-plan whenever the validator or improver surface new gaps.`
  );
}

function coordinatorPrompt(goal: string): string {
  return (
    intro(goal, "the COORDINATOR") +
    `You ROUTE, you do not implement. Take the planner's tasks, assign each to a worker via Agent ` +
    `Mail (balance the load), track who holds what, and keep the pipeline moving. Route the ` +
    `improver's fix tasks to a free worker as they appear.`
  );
}

function workerPrompt(goal: string, n: number): string {
  return (
    intro(goal, `WORKER-${n}`) +
    `Your loop: poll Agent Mail + the task list for an unclaimed or assigned task. Claim it ` +
    `(TaskUpdate -> in_progress), implement it FOR REAL (edit files, run commands), then mark it ` +
    `completed and Agent-Mail the VALIDATOR: "done: <task> — please verify". Pick up FIX tasks the ` +
    `validator/improver create. Keep working until the validator reports the goal passes. Take a ` +
    `file lease before editing shared files so workers do not collide.`
  );
}

function validatorPrompt(goal: string): string {
  return (
    intro(goal, "the VALIDATOR") +
    `Your loop: watch the task list and your inbox for completed work. VALIDATE IT FOR REAL — run ` +
    `the project's actual test suite (find the test command in package.json / pyproject / Makefile ` +
    `and run it via Bash), and if the Claude-in-Chrome or computer-use tools are available to you, ` +
    `open the running app and check the real behavior. For each result, Agent-Mail PASS with the ` +
    `evidence (command + output), or on failure Agent-Mail "FAIL: <what broke + how you checked>" ` +
    `to the improver AND create a fix task (TaskCreate) so a worker picks it up. Never report a ` +
    `pass you did not actually run.`
  );
}

function improverPrompt(goal: string): string {
  return (
    intro(goal, "the IMPROVER") +
    `Your loop: read the VALIDATOR's failures and open gaps (inbox + task list). Turn each into a ` +
    `concrete next step: create a fix task (TaskCreate) and Agent-Mail the workers a ticket that ` +
    `says exactly what to change and why. When a piece is large, spawn a fresh sub-agent (the Task ` +
    `tool) to do focused work and fold in its result. Keep the cycle alive: gap -> ticket + task -> ` +
    `worker -> validator -> repeat, until the validator confirms the goal is genuinely met.`
  );
}

// The conductor (the session the user picked) orchestrates the spawned swarm. The loop SHAPE
// names the cycle's stop condition (the header's shape select, default Land): the same eight
// shapes the rail teaches, applied to the spawned-session swarm instead of in-conductor
// sub-agents. Without one the cycle falls back to Land's "until genuinely met".
export function conductorBlueprint(
  goal: string,
  nodes: Record<string, string>,
  shape?: { name: string; tagline: string; stop: string },
): string {
  const roster = Object.keys(nodes).join(", ") || "the swarm";
  const loop = shape
    ? `Run the cycle as a ${shape.name.toUpperCase()} loop: ${shape.tagline} This loop ${shape.stop}, ` +
      `so drive the swarm round by round against that stop condition and report when it is reached.`
    : `Keep the loop running until the validator reports the goal is genuinely met.`;
  return (
    `You are the CONDUCTOR of a live agent swarm. Goal:\n\n${goal}\n\n` +
    `I have spawned dedicated teammate sessions: ${roster}. They each poll Agent Mail and the ` +
    `shared task list. Orchestrate the real cycle: decompose the goal into concrete tasks ` +
    `(TaskCreate), Agent-Mail each worker its assignment, let the validator verify with real tests ` +
    `(and Chrome/computer-use if available), and let the improver turn failures into new tasks + ` +
    `tickets. ${loop} Do not ` +
    `simulate any of it — coordinate over Agent Mail and the task list for real.`
  );
}

// Spawn one BARE session (no prompt: the model/effort slash commands go in first, then the
// role prompt) and resolve its voxherd session_id (the bridge returns a tmux name; the
// session_id is assigned on registration, so we poll until a new one appears).
async function spawnAndFind(
  project: string,
  dir: string | undefined,
  known: Set<string>,
): Promise<string | null> {
  const r = await spawnSession({ project, dir });
  if (!r.ok) return null;
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    let sessions;
    try {
      sessions = await fetchSessions();
    } catch {
      continue;
    }
    const fresh = sessions.find((s) => s.project === project && !known.has(s.session_id));
    if (fresh) {
      known.add(fresh.session_id);
      return fresh.session_id;
    }
  }
  return null;
}

export async function spawnSwarm(opts: {
  project: string;
  dir?: string;
  goal: string;
  workers: number;
  // Per-role model + effort: typed into each fresh session as /model + /effort BEFORE its
  // role prompt, so the whole role runs on the chosen brain (defaults in role-models.ts).
  models?: SwarmModels;
  onProgress?: (msg: string) => void;
  // Fires the instant each node's session registers, so the board can map + stream its live
  // terminal immediately instead of waiting for the whole swarm (5-8 sessions) to finish.
  onNode?: (node: string, sessionId: string) => void;
}): Promise<Record<string, string>> {
  const { project, dir, goal, workers, models, onProgress, onNode } = opts;
  let known: Set<string>;
  try {
    known = new Set((await fetchSessions()).map((s) => s.session_id));
  } catch {
    known = new Set();
  }
  const map: Record<string, string> = {};

  const place = async (node: string, prompt: string) => {
    onProgress?.(`spawning ${node}…`);
    const sid = await spawnAndFind(project, dir, known);
    if (!sid) return;
    map[node] = sid;
    // Name it at the voxherd level (no-op on older bridge builds) and tell the caller NOW so the
    // node lights up + streams its real terminal as soon as it is alive.
    void renameSession(sid, node);
    onNode?.(node, sid);
    // Configure the brain FIRST: /model + /effort go down the same send-keys path as every
    // other command, into the still-idle session, so the role prompt below runs on the chosen
    // model instead of the default. Short settles keep the typed lines from interleaving.
    const role = roleKeyOf(node);
    const cfg = role ? models?.[role] : undefined;
    await sleep(800);
    if (cfg) {
      onProgress?.(`${node}: /model ${cfg.model} · /effort ${cfg.effort}`);
      await sendCommand({ project, session_id: sid, message: `/model ${cfg.model}` });
      await sleep(600);
      await sendCommand({ project, session_id: sid, message: `/effort ${cfg.effort}` });
      await sleep(600);
    }
    await sendCommand({ project, session_id: sid, message: prompt });
  };

  await place("planner", plannerPrompt(goal));
  await place("coordinator", coordinatorPrompt(goal));
  await place("validator", validatorPrompt(goal));
  await place("improver", improverPrompt(goal));
  const count = Math.max(1, Math.min(4, workers));
  for (let i = 1; i <= count; i += 1) await place(`worker-${i}`, workerPrompt(goal, i));
  return map;
}
