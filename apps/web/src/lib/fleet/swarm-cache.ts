// A local persistent cache for the swarm: every bead we have seen (a task or a sub-agent) and
// a timeline log of what happened, keyed by conductor project, mirrored to localStorage so it
// survives the run ending AND a full page reload. This is what makes results stick: voxherd
// discards a sub-agent's data the moment it finishes, so we capture the signal as it streams
// and keep our own copy. The user should never be told to "scroll up in the console".
//
// Zero-dependency on purpose: React's useSyncExternalStore + localStorage is exactly what
// zustand's persist middleware does under the hood, and the zustand install currently aborts
// on a pre-existing workspace issue (@glassbox/contract is not a resolvable workspace pkg).

import { useSyncExternalStore } from "react";

export interface CachedBead {
  id: string; // the bead id: a task id ("116") or a sub-agent id ("sub-0")
  kind: "task" | "subagent";
  title: string;
  description?: string; // the task prompt, or for a completed task the recorded RESULT
  result?: string; // an explicit result, if we ever learn one separate from the description
  status: string; // pending | in_progress | completed | done
  lane?: string; // worker-1..N (where it ran)
  firstSeen: number;
  lastSeen: number;
}

export interface LogEntry {
  ts: number;
  kind: "spawn" | "done" | "skill" | "note" | "loop";
  text: string;
  agent?: string;
  beadId?: string;
}

export interface RunCache {
  beads: Record<string, CachedBead>;
  log: LogEntry[];
  // sessionId -> node label (planner, coordinator, worker-1, ...) so spawned teammate sessions
  // show their ROLE in the UI instead of a generic "web #7", and survive a reload.
  roles: Record<string, string>;
  updatedAt: number;
}

type State = Record<string, RunCache>; // project -> cache

// One spawned swarm: the driving conductor session + its sub-agent worker sessions, keyed by
// the CONDUCTOR's session id (not project, since many sessions can share a project). Drives the
// nested picker: expand a swarm to see its driving node + nested workers.
export interface SwarmRoster {
  conductor: string; // conductor session id
  project: string;
  nodes: Record<string, string>; // node role (planner, worker-1, ...) -> worker session id
  ts: number;
}
type Rosters = Record<string, SwarmRoster>; // conductor session id -> roster

const KEY = "glassbox-swarm-cache-v1";
const ROSTER_KEY = "glassbox-swarm-rosters-v1";
const MAX_LOG = 200;
const isDone = (s: string) => s === "completed" || s === "done";

let state: State = load();
let rosters: Rosters = loadRosters();
const listeners = new Set<() => void>();

function load(): State {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as State) : {};
  } catch {
    return {};
  }
}

function loadRosters(): Rosters {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ROSTER_KEY);
    return raw ? (JSON.parse(raw) as Rosters) : {};
  } catch {
    return {};
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    window.localStorage.setItem(ROSTER_KEY, JSON.stringify(rosters));
  } catch {
    /* quota hit or storage disabled: keep it in memory for this session */
  }
}

function emit() {
  persist();
  for (const l of listeners) l();
}

function ensure(project: string): RunCache {
  if (!state[project]) state[project] = { beads: {}, log: [], roles: {}, updatedAt: 0 };
  else if (!state[project].roles) state[project].roles = {}; // backfill caches saved before roles existed
  return state[project];
}

export const swarmCache = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getRun(project: string): RunCache | undefined {
    return state[project];
  },
  // Merge a bead in. Set fields win; we never lose a description/result/lane we already had.
  // Auto-logs the two transitions worth a timeline entry: first sight, and completion.
  recordBead(project: string, bead: Partial<CachedBead> & { id: string }) {
    const run = ensure(project);
    const prev = run.beads[bead.id];
    const now = Date.now();
    const merged: CachedBead = {
      id: bead.id,
      kind: bead.kind ?? prev?.kind ?? "task",
      title: bead.title ?? prev?.title ?? `bead ${bead.id}`,
      description: bead.description ?? prev?.description,
      result: bead.result ?? prev?.result,
      status: bead.status ?? prev?.status ?? "pending",
      lane: bead.lane ?? prev?.lane,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
    };
    const unchanged =
      prev &&
      prev.kind === merged.kind &&
      prev.title === merged.title &&
      prev.description === merged.description &&
      prev.result === merged.result &&
      prev.status === merged.status &&
      prev.lane === merged.lane;
    if (unchanged) return; // no-op write (e.g. a repeat poll): skip to avoid render churn

    const beads = { ...run.beads, [bead.id]: merged };
    let log = run.log;
    const entry: Omit<LogEntry, "ts"> | null = !prev
      ? { kind: "spawn", text: merged.title, beadId: merged.id, agent: merged.lane }
      : !isDone(prev.status) && isDone(merged.status)
        ? {
            kind: "done",
            text: merged.result ? `${merged.title}: ${merged.result}` : merged.title,
            beadId: merged.id,
            agent: merged.lane,
          }
        : null;
    if (entry) log = [...log, { ts: now, ...entry }].slice(-MAX_LOG);

    state = { ...state, [project]: { beads, log, roles: run.roles, updatedAt: now } };
    emit();
  },
  log(project: string, entry: Omit<LogEntry, "ts">) {
    const run = ensure(project);
    const last = run.log[run.log.length - 1];
    if (last && last.text === entry.text && last.kind === entry.kind) return; // dedup repeats
    const now = Date.now();
    const log = [...run.log, { ts: now, ...entry }].slice(-MAX_LOG);
    state = { ...state, [project]: { ...run, log, updatedAt: now } };
    emit();
  },
  // Associate a spawned session with its node role (planner, worker-1, ...). Persisted so the
  // session shows its role in the conductor picker and survives a reload.
  setRole(project: string, sessionId: string, node: string) {
    const run = ensure(project);
    if (run.roles[sessionId] === node) return;
    const roles = { ...run.roles, [sessionId]: node };
    state = { ...state, [project]: { ...run, roles, updatedAt: Date.now() } };
    emit();
  },
  // Record a whole spawned swarm (conductor + its worker sessions) so the picker can nest the
  // workers under their driving node. Keyed by conductor session id.
  setSwarm(conductor: string, project: string, nodes: Record<string, string>) {
    rosters = { ...rosters, [conductor]: { conductor, project, nodes, ts: Date.now() } };
    emit();
  },
  removeSwarm(conductor: string) {
    if (!rosters[conductor]) return;
    const next = { ...rosters };
    delete next[conductor];
    rosters = next;
    emit();
  },
  getSwarms(): Rosters {
    return rosters;
  },
  // Wipe the node-role map for a project. Called on teardown so a killed swarm cannot leave a
  // worker pointed at a session id that outlives the kill (and re-lights that lane on the board).
  clearRoles(project: string) {
    const run = state[project];
    if (!run || !Object.keys(run.roles).length) return;
    state = { ...state, [project]: { ...run, roles: {}, updatedAt: Date.now() } };
    emit();
  },
  // Drop any role mapping or roster entry whose session is no longer alive, so a swarm killed
  // OUTSIDE the clean-up button (a process exit, an external kill) self-cleans instead of leaving
  // a stale worker->session mapping on the board.
  pruneToLive(liveSids: Set<string>) {
    let changed = false;
    const nextState = { ...state };
    for (const [project, run] of Object.entries(state)) {
      const cur = run.roles ?? {}; // old caches can predate the roles field
      const roles = Object.fromEntries(Object.entries(cur).filter(([sid]) => liveSids.has(sid)));
      if (Object.keys(roles).length !== Object.keys(cur).length) {
        nextState[project] = { ...run, roles };
        changed = true;
      }
    }
    const nextRosters = { ...rosters };
    for (const [cid, sw] of Object.entries(rosters)) {
      if (!liveSids.has(sw.conductor)) {
        delete nextRosters[cid];
        changed = true;
        continue;
      }
      const curNodes = sw.nodes ?? {};
      const nodes = Object.fromEntries(Object.entries(curNodes).filter(([, sid]) => liveSids.has(sid)));
      if (Object.keys(nodes).length !== Object.keys(curNodes).length) {
        nextRosters[cid] = { ...sw, nodes };
        changed = true;
      }
    }
    if (!changed) return;
    state = nextState;
    rosters = nextRosters;
    emit();
  },
  clear(project: string) {
    if (!state[project]) return;
    const next = { ...state };
    delete next[project];
    state = next;
    emit();
  },
};

const EMPTY: RunCache = { beads: {}, log: [], roles: {}, updatedAt: 0 };

// Subscribe a component to one project's cache. Stable EMPTY reference keeps
// useSyncExternalStore happy when there is nothing cached yet (no render loop).
export function useSwarmRun(project: string | undefined): RunCache {
  return useSyncExternalStore(
    swarmCache.subscribe,
    () => (project ? (state[project] ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}

const EMPTY_ROSTERS: Rosters = {};

// Subscribe to the spawned-swarm rosters (conductor -> workers) for the nested picker.
export function useSwarms(): Rosters {
  return useSyncExternalStore(
    swarmCache.subscribe,
    () => rosters,
    () => EMPTY_ROSTERS,
  );
}
