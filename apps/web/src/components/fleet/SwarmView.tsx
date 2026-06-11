"use client";

// The swarm command center: a full-bleed live node board of the conductor's real swarm,
// with the conductor console and the archetype/skills rail floating over it as glass panels
// (collapsible, with the board reframing to use the reclaimed space) plus zoom controls.
// This unifies the three projects in one seat: vibe-view UX + voxherd workers + skillvault
// skills + the node board.

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Editor } from "tldraw";
import type { GlassboxEvent } from "@glassbox/contract";

import { sendCommand } from "@/lib/voxherd/client";
import type { VoxSession } from "@/lib/voxherd/types";
import { openTerminalStream, killSession } from "@/lib/voxherd/ws";
import { spawnSwarm, conductorBlueprint } from "@/lib/voxherd/swarm-spawn";
import { startArchetypeLoop, type LoopHandle, type LoopState } from "@/lib/voxherd/loop";
import type { BoardController } from "@/lib/cockpit/board";
const SwarmBoard = dynamic(() => import("@/components/fleet/SwarmBoard").then((m) => m.SwarmBoard), { ssr: false });
import { ArchetypeRail } from "@/components/fleet/ArchetypeRail";
import { SkillsMenu } from "@/components/fleet/SkillsMenu";
import { AnsiLines } from "@/components/fleet/AnsiLines";
import { ActivityFeed, type ActivityEntry } from "@/components/fleet/ActivityFeed";
import { CollapseButton } from "@/components/cockpit/CollapseButton";
import {
  LoopShapeContext,
  type LoopShapeStatus,
} from "@/components/fleet/loop-shape-context";
import type { Archetype } from "@/lib/fleet/archetypes";
import { LOOP_SHAPES } from "@/lib/fleet/loop-shapes";
import type { SkillPackage } from "@/lib/skillvault/client";
import { swarmCache, useSwarmRun, useSwarms } from "@/lib/fleet/swarm-cache";
import { useSessions } from "@/lib/voxherd/useSessions";
import { SwarmPicker } from "@/components/fleet/SwarmPicker";

// Status -> dot color for the history list (warm palette: one orange accent, muted otherwise).
const statusTone = (s: string) => {
  const v = (s ?? "").toLowerCase();
  if (v === "in_progress" || v === "working") return "text-accent";
  if (v === "completed" || v === "done") return "text-ink-mid";
  return "text-ink-dim";
};
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const WORKER_CHOICES = [1, 2, 3, 4];
const SELECT_CLS =
  "rounded-md border border-line bg-canvas/70 px-2 py-1 text-xs text-ink outline-none focus:border-accent/60";

export function SwarmView() {
  // Shared, reference-counted session poller (same interval as FleetView/FleetBoard).
  const { sessions } = useSessions();
  const [conductorId, setConductorId] = useState("");
  const [workers, setWorkers] = useState(4);
  const [note, setNote] = useState("");
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleTab, setConsoleTab] = useState<"console" | "history" | "mail">("console");
  // Live agent-to-agent coordination feed (the REAL Agent Mail the spawned swarm uses).
  const [mail, setMail] = useState<{ id: number; from: string; subject: string; importance: string; ts: string }[]>([]);
  const [railOpen, setRailOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [tasks, setTasks] = useState<
    Record<string, { subject?: string; description?: string; status?: string }>
  >({});
  const [picked, setPicked] = useState<{ id: string; x: number; y: number } | null>(null);
  const [subDetail, setSubDetail] = useState<Record<string, { subject: string; description?: string }>>({});
  const [workerTasks, setWorkerTasks] = useState<Record<string, string[]>>({});
  const [pickedWorker, setPickedWorker] = useState<string | null>(null);
  const [nodeSessions, setNodeSessions] = useState<Record<string, string>>({});
  const [workerLines, setWorkerLines] = useState<string[]>([]);
  const [workerInput, setWorkerInput] = useState("");
  const [realGoal, setRealGoal] = useState("");
  const [spawning, setSpawning] = useState(false);
  // Persisted (Redis) per-node session log snapshots: the durable record that survives teardown.
  const [swarmLogs, setSwarmLogs] = useState<
    Record<string, { sessionId?: string; summary?: string; preview?: string; activity?: string; status?: string; ts: number }>
  >({});
  const snapRef = useRef<Record<string, string>>({});
  const torndownRef = useRef(false);
  const termRef = useRef<HTMLPreElement>(null);
  const workerTermRef = useRef<HTMLPreElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const controllerRef = useRef<BoardController | null>(null);
  const loopRef = useRef<LoopHandle | null>(null);
  const [loop, setLoop] = useState<LoopState | null>(null);
  // The active loop shape (contract archetype id): drives the board's return-edge
  // overlay and the lane relabels. Kept after the loop ends so the end chip
  // (landed, plateau, winner picked) stays readable; replaced on the next Run.
  const [loopShapeId, setLoopShapeId] = useState<string | null>(null);
  const loopShapeIdRef = useRef<string | null>(null);
  // The activity log derives the loop's round/finish beats from the loop snapshot, which keeps
  // no history of its own. These track what we have already logged so a re-emit of the same
  // round (the kernel emits on every terminal frame) does not double-log. Reset in runSwarm.
  const lastLoggedRoundRef = useRef(0);
  const loggedFinishRef = useRef(false);
  const seenSubRef = useRef<Set<string>>(new Set());
  const prevSubCountRef = useRef(0);
  const searchParams = useSearchParams();
  // The floating header wraps on smaller screens (flex-wrap), so its height is not
  // fixed. Measure it and offset every floating panel (console, inspector, rail) and
  // the loop pill below the real header bottom, instead of a hardcoded top-[68px]
  // that the wrapped header slides under.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(52);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  // Panels start just below the measured header. headerH already includes the
  // header's own p-3 bottom padding (~12px), so this is the only gutter; keep it
  // tight so the conductor window hugs the top bar instead of floating far below.
  const panelTop = headerH;
  const pillTop = headerH - 6;

  const conductor = sessions.find((s) => s.session_id === conductorId) ?? null;
  // The persistent local cache for THIS conductor's project: beads + a what-happened log that
  // survive the run ending and a page reload. Populated by the polls/reflection below.
  const run = useSwarmRun(conductor?.project);
  const swarms = useSwarms();

  // Poll the real Agent Mail feed (mcp-agent-mail, via /api/agentmail) while the console OR the
  // rail is open, so both the mail tab and the activity log can watch the swarm assign + report
  // work, the other half of the task list beads.
  useEffect(() => {
    if (!consoleOpen && !railOpen) return;
    let alive = true;
    const tick = () =>
      fetch("/api/agentmail?limit=60", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { messages?: typeof mail }) => {
          if (alive && d.messages) setMail(d.messages);
        })
        .catch(() => {});
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [consoleOpen, railOpen]);

  // --- Render-phase view-state resets -------------------------------------------------
  // Reset transient view state during render when the key it mirrors changes, rather than
  // clearing it synchronously inside the matching effect. React's "adjust state on
  // dependency change" pattern (the same one the cockpit curve uses): behavior-identical,
  // but it avoids the extra cascading render an in-effect setState queues. The effects
  // below now only open their stream / start their poll.
  const conductorProject = conductor?.project ?? "";

  // Deep-link: /swarm?session=<id> pre-selects the conductor once that session loads.
  // Self-limiting (it clears its own precondition once it sets conductorId), so no
  // prev-tracker is needed.
  const wanted = searchParams?.get("session") ?? "";
  if (wanted && !conductorId && sessions.some((s) => s.session_id === wanted)) {
    setConductorId(wanted);
  }

  // Deep-link: /swarm?shape=<id> pre-arms a loop shape so its return edge, lane
  // relabels, and (for race) the parallel-lane column render without running a
  // loop. The demo's "show every shape" surface; running a loop replaces it.
  // Render only sets state (same self-limiting pattern as ?session=); the
  // controller side effect runs in the loopShapeId effect below.
  const wantedShape = searchParams?.get("shape") ?? "";
  if (wantedShape && !loopShapeId && wantedShape in LOOP_SHAPES) {
    setLoopShapeId(wantedShape);
  }

  const [prevConductorId, setPrevConductorId] = useState(conductorId);
  if (prevConductorId !== conductorId) {
    setPrevConductorId(conductorId);
    setLines([]); // conductor terminal restarts (or clears when deselected)
  }

  const pickedSid = pickedWorker ? nodeSessions[pickedWorker] : undefined;
  const [prevPickedSid, setPrevPickedSid] = useState(pickedSid);
  if (prevPickedSid !== pickedSid) {
    setPrevPickedSid(pickedSid);
    setWorkerLines([]); // picked node's own terminal restarts (or clears when none)
  }

  const [prevTasksProject, setPrevTasksProject] = useState(conductorProject);
  if (prevTasksProject !== conductorProject) {
    setPrevTasksProject(conductorProject);
    if (!conductorProject) setTasks({}); // only clear when the project goes away (matches old reset)
  }

  const [prevLogsProject, setPrevLogsProject] = useState(conductorProject);
  if (prevLogsProject !== conductorProject) {
    setPrevLogsProject(conductorProject);
    if (!conductorProject) setSwarmLogs({}); // only clear when the project goes away
  }
  // ------------------------------------------------------------------------------------

  const counts = useMemo(() => {
    const vals = Object.values(tasks);
    const st = (t: { status?: string }) => (t.status ?? "").toLowerCase();
    return {
      working: vals.filter((t) => st(t) === "in_progress").length,
      queued: vals.filter((t) => st(t) === "pending").length,
      done: vals.filter((t) => st(t) === "completed" || st(t) === "done").length,
    };
  }, [tasks]);

  // The ordered ring of nodes: planner -> coordinator -> the active workers ->
  // validator -> improver, wrapping around. Drives the inspector's < node > cycler.
  const nodeRing = useMemo(
    () => [
      "planner",
      "coordinator",
      ...Array.from({ length: workers }, (_, i) => `worker-${i + 1}`),
      "validator",
      "improver",
    ],
    [workers],
  );
  // Step the OPEN inspector to the previous/next node in the ring and focus the camera
  // on it, so the side panel itself is the node tour (the < node > control lives in its
  // header now, not floating over the graph). Wraps from the inspector's current node.
  const cyclePicked = useCallback(
    (dir: 1 | -1) => {
      const n = nodeRing.length;
      const cur = pickedWorker ? nodeRing.indexOf(pickedWorker) : 0;
      const next = (((cur < 0 ? 0 : cur) + dir) % n + n) % n;
      const node = nodeRing[next];
      setPickedWorker(node);
      controllerRef.current?.focusAgent(node);
    },
    [nodeRing, pickedWorker],
  );

  // Stop any running loop when leaving the swarm view.
  useEffect(() => () => loopRef.current?.stop(), []);

  // Apply the active loop shape's board treatment (lane relabels + the race
  // column) whenever it changes, and keep the remount ref in sync so
  // onBoardReady can re-apply it after a conductor switch rebuilds the board.
  useEffect(() => {
    loopShapeIdRef.current = loopShapeId;
    const spec = loopShapeId ? LOOP_SHAPES[loopShapeId] : undefined;
    controllerRef.current?.setLoopShape(
      spec ? { roles: spec.roles, column: spec.column } : null,
    );
  }, [loopShapeId]);

  // Stream the conductor's terminal into the console, but only while the console is open:
  // `lines` is rendered nowhere else, so streaming it (a live WS + a setLines re-render of
  // this whole view per terminal frame) while the panel is collapsed is pure waste. The
  // bridge pushes the full terminal buffer on subscribe (terminal_content is a snapshot, and
  // setLines replaces wholesale), so reopening the console repaints the current state with no
  // lost history. Same gate as the Agent Mail poll above.
  useEffect(() => {
    if (!conductorId || !consoleOpen) return; // lines are cleared during render when conductorId changes
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void openTerminalStream(conductorId, (ls) => {
      // Streaming log text is non-urgent: a transition keeps the console responsive
      // (typing, clicking) while a burst of terminal output floods in.
      if (!cancelled) startTransition(() => setLines(ls));
    }).then((fn) => {
      if (cancelled) fn();
      else cleanup = fn;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [conductorId, consoleOpen]);

  // Pin the conductor stream to the newest line, and jump to the bottom when it opens.
  useEffect(() => {
    if (!consoleOpen) return;
    const toBottom = () => {
      const el = termRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    toBottom();
    const r = requestAnimationFrame(toBottom);
    return () => cancelAnimationFrame(r);
  }, [lines, consoleOpen]);

  // Poll the conductor's task list so a bead click can show what that work actually is.
  useEffect(() => {
    if (!conductor?.project) return; // tasks cleared during render when the project goes away
    const project = conductor.project;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/voxherd/api/tasks/${encodeURIComponent(project)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as
          | { tasks?: { id: string | number; subject?: string; description?: string; status?: string }[] }
          | { id: string | number; subject?: string; description?: string; status?: string }[];
        const list = Array.isArray(data) ? data : (data.tasks ?? []);
        if (!alive) return;
        const byId: Record<string, { subject?: string; description?: string; status?: string }> = {};
        for (const t of list) {
          const id = String(t.id);
          byId[id] = t;
          // Keep our own copy so the bead and its recorded result persist after the run and
          // across reloads, even if voxherd later drops the task. For a completed task the
          // description carries the RESULT (the cycle TaskUpdates it before closing).
          swarmCache.recordBead(project, {
            id,
            kind: "task",
            title: t.subject ?? `task ${id}`,
            description: t.description,
            status: t.status ?? "pending",
          });
        }
        setTasks(byId);
      } catch {
        /* keep last */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [conductor?.project]);

  // A bead click on the board dispatches glassbox:bead-click; open a task-detail card.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ beadId?: string; x?: number; y?: number }>;
      const beadId = ce.detail?.beadId ?? "";
      const id = beadId.startsWith("task-") ? beadId.slice(5) : beadId;
      if (id) setPicked({ id, x: ce.detail?.x ?? 200, y: ce.detail?.y ?? 200 });
    };
    window.addEventListener("glassbox:bead-click", handler);
    return () => window.removeEventListener("glassbox:bead-click", handler);
  }, []);

  // Track which tasks are on which worker (from the adapter's claim/done events) so the
  // worker inspector can show what each worker is actually doing.
  const onBoardEvent = useCallback((ev: GlassboxEvent) => {
    const id = ev.bead_id?.startsWith("task-") ? ev.bead_id.slice(5) : "";
    if (!id) return;
    // Board events (bead_claimed/bead_done) arrive in bursts as the swarm churns and only
    // feed the worker inspector, not the tldraw board itself. Mark the state update as a
    // transition (same pattern as the terminal streams above) so a flood of events does
    // not block this large panel-heavy view from staying interactive.
    if (ev.type === "bead_claimed" && ev.agent?.startsWith("worker-")) {
      const worker = ev.agent;
      startTransition(() =>
        setWorkerTasks((prev) => {
          const next: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(prev)) next[k] = v.filter((x) => x !== id);
          next[worker] = [...(next[worker] ?? []), id];
          return next;
        }),
      );
    } else if (ev.type === "bead_done") {
      startTransition(() =>
        setWorkerTasks((prev) => {
          const next: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(prev)) next[k] = v.filter((x) => x !== id);
          return next;
        }),
      );
    }
  }, []);

  // Clicking an agent node opens a panel showing what that worker is doing.
  useEffect(() => {
    const handler = (e: Event) => {
      const agent = (e as CustomEvent<{ agent?: string }>).detail?.agent;
      if (agent) {
        setConsoleOpen(true);
        setPickedWorker(agent);
      }
    };
    window.addEventListener("glassbox:agent-click", handler);
    return () => window.removeEventListener("glassbox:agent-click", handler);
  }, []);

  // Stream the picked node's OWN session terminal, if it is a real spawned session (Phase B).
  useEffect(() => {
    if (!pickedSid) return; // workerLines cleared during render when pickedSid changes
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void openTerminalStream(pickedSid, (ls) => {
      // Non-urgent streaming text (see the conductor stream above): transition it so
      // the worker inspector stays interactive under a flood of output.
      if (!cancelled) startTransition(() => setWorkerLines(ls));
    }).then((fn) => {
      if (cancelled) fn();
      else cleanup = fn;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // Key on the resolved session id, not [pickedWorker, nodeSessions]: with nodeSessions
    // now change-gated, the stream only reopens when the picked node's actual session id
    // changes (not on every poll that returns an equal map).
  }, [pickedSid]);

  useEffect(() => {
    const el = workerTermRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [workerLines]);

  // Reset the sub-agent tracking when the conductor changes.
  useEffect(() => {
    seenSubRef.current = new Set();
    prevSubCountRef.current = 0;
  }, [conductorId]);

  // Reflect the conductor's REAL sub-agent activity on the board: a bead per sub-agent it
  // dispatches, on the worker lanes. voxherd tracks these via its subagent hooks, so ANY
  // conductor (even your own terminal session) lights up its workers the moment it spawns
  // sub-agents, with no dependency on a shared task store.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !conductor) return;
    const ev = (type: GlassboxEvent["type"], agent: string, extra: Partial<GlassboxEvent>) =>
      controller.apply({ ts: Date.now(), type, run_id: "subagents", planner_version: 1, agent, ...extra } as GlassboxEvent);
    const tasks = (conductor.sub_agent_tasks ?? []) as unknown[];
    const count = conductor.sub_agent_count ?? tasks.length;
    const label = (t: unknown, i: number) => {
      if (typeof t === "string") return t;
      if (t && typeof t === "object") {
        const o = t as Record<string, unknown>;
        return String(o.subject ?? o.description ?? o.title ?? o.name ?? o.prompt ?? `sub-agent ${i + 1}`);
      }
      return `sub-agent ${i + 1}`;
    };
    const newDetail: Record<string, { subject: string; description?: string }> = {};
    tasks.forEach((t, i) => {
      const id = `sub-${i}`;
      if (seenSubRef.current.has(id)) return;
      seenSubRef.current.add(id);
      const worker = `worker-${(i % 4) + 1}`;
      const title = label(t, i);
      const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      const description = o.description ? String(o.description) : o.prompt ? String(o.prompt) : undefined;
      newDetail[id] = { subject: title, description };
      // Capture it NOW, while it is live: voxherd clears sub_agent_tasks the instant the
      // sub-agent finishes, so this is our only chance to keep a record of it.
      swarmCache.recordBead(conductor.project, {
        id,
        kind: "subagent",
        title,
        description,
        lane: worker,
        status: "in_progress",
      });
      ev("bead_created", "planner", { bead_id: id, title, payload: { capability: "subagent" } });
      ev("bead_claimed", worker, { bead_id: id, title, payload: { capability: "subagent" } });
    });
    if (Object.keys(newDetail).length) setSubDetail((prev) => ({ ...prev, ...newDetail }));
    if (prevSubCountRef.current > 0 && count === 0 && seenSubRef.current.size) {
      let i = 0;
      for (const id of seenSubRef.current) {
        ev("bead_done", `worker-${(i % 4) + 1}`, { bead_id: id, payload: { capability: "subagent" } });
        // Mark the cached copy done so the history shows it finished (the bead persists).
        swarmCache.recordBead(conductor.project, { id, status: "done" });
        i += 1;
      }
      seenSubRef.current = new Set();
    }
    prevSubCountRef.current = count;
  }, [conductor, conductor?.sub_agent_tasks, conductor?.sub_agent_count]);

  // Reflect the swarm's Agent Mail onto the lanes as a per-node COUNT BADGE, not as free beads.
  // The old approach dropped one bead per worker and flowed the "done" ones into the validator's
  // done rail, where they piled up and overlapped. Now the activity log carries the message text,
  // so the board only needs to show WHERE coordination is happening: a small "mail N" chip on each
  // worker lane, tallied from the recent mail (a sender's lane is learned from any message that
  // names a worker, so that sender's other messages count toward the same lane).
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const workerOf = (s: string): string | null => {
      const w = s.match(/worker[\s-]?([1-4])/i);
      return w ? `worker-${w[1]}` : null;
    };
    const nameToWorker: Record<string, string> = {};
    for (const m of mail) {
      const w = workerOf(m.subject);
      if (w) nameToWorker[m.from] = w;
    }
    const counts: Record<string, number> = {};
    for (const m of mail) {
      const w = nameToWorker[m.from] ?? workerOf(m.subject);
      if (w) counts[w] = (counts[w] ?? 0) + 1;
    }
    for (let i = 1; i <= 4; i += 1) {
      const worker = `worker-${i}`;
      controller.setMailCount(worker, counts[worker] ?? 0);
    }
  }, [mail]);

  // Light up the board's mapped nodes from their REAL spawned sessions' status (Phase B):
  // once a node has a dedicated session, its lane reflects that session, not the task lanes.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    for (const [node, sid] of Object.entries(nodeSessions)) {
      const s = sessions.find((x) => x.session_id === sid);
      controller.apply({
        ts: Date.now(),
        type: "agent_status",
        run_id: "real",
        planner_version: 1,
        agent: node,
        payload: { status: s?.status === "active" ? "working" : "idle" },
      } as GlassboxEvent);
    }
  }, [nodeSessions, sessions]);

  // Hydrate node->session mappings from the persisted role map so a reloaded page still streams
  // each spawned teammate's terminal. ONLY map sessions that are still LIVE: a dead roster (a
  // swarm we killed) would otherwise point a worker at a corpse, blocking both the live terminal
  // and the saved-log fallback. Existing live mappings win.
  useEffect(() => {
    const roles = run.roles;
    if (!roles || !Object.keys(roles).length) return;
    const inv: Record<string, string> = {};
    for (const [sid, node] of Object.entries(roles)) {
      if (sessions.some((s) => s.session_id === sid)) inv[node] = sid;
    }
    if (Object.keys(inv).length) {
      // Add only role mappings we are not already tracking, and bail (return the same
      // ref) when there is nothing new. The old `{ ...inv, ...prev }` built a fresh object
      // on every sessions poll even when the map was unchanged, cascading into every
      // effect keyed on nodeSessions. Existing live mappings still win.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- gated external sync: returns prev (no re-render) when unchanged
      setNodeSessions((prev) => {
        const additions = Object.entries(inv).filter(([node]) => !(node in prev));
        if (!additions.length) return prev;
        return { ...prev, ...Object.fromEntries(additions) };
      });
    }
  }, [run.roles, sessions]);

  // Self-clean stale bookkeeping: drop any cached role/roster whose session is no longer alive, so
  // a swarm killed outside the clean-up button can't leave a worker pointed at a dead session (and
  // the hydrate above can't re-light a lane from it). Guarded on a non-empty poll to avoid wiping
  // everything on a transient empty fetch.
  useEffect(() => {
    if (!sessions.length) return;
    swarmCache.pruneToLive(new Set(sessions.map((s) => s.session_id)));
  }, [sessions]);

  // Poll the durable swarm logs for this project from Redis (server-side, shared across tabs,
  // survives teardown + reload). This is the source of truth; localStorage is just a cache.
  // Polling (not one-shot) so a result the conductor records mid-run shows up live, no reload.
  useEffect(() => {
    if (!conductor?.project) return; // swarmLogs cleared during render when the project goes away
    const project = conductor.project;
    let alive = true;
    const tick = () =>
      fetch(`/api/swarm/log?project=${encodeURIComponent(project)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then(
          (d: {
            nodes?: Record<
              string,
              { sessionId?: string; summary?: string; preview?: string; activity?: string; status?: string; ts: number }
            >;
          }) => {
            // Merge Redis over local so a freshly-recorded worker result appears without dropping
            // the live snapshots the per-node effect writes.
            const nodes = d.nodes;
            if (alive && nodes) setSwarmLogs((prev) => ({ ...prev, ...nodes }));
          },
        )
        .catch(() => {});
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [conductor?.project]);

  // Continuously snapshot each spawned node's session log to Redis as it changes, so when the
  // session is later killed its log is already saved and stays readable.
  useEffect(() => {
    if (!conductor?.project) return;
    const project = conductor.project;
    type Snap = { node: string; sessionId: string; summary?: string; preview?: string; activity?: string; status?: string; ts: number };
    const pending: Snap[] = [];
    for (const [node, sid] of Object.entries(nodeSessions)) {
      const s = sessions.find((x) => x.session_id === sid);
      if (!s) continue;
      const sig = `${s.last_summary ?? ""}|${s.terminal_preview ?? ""}|${s.status ?? ""}`;
      if (snapRef.current[node] === sig) continue;
      snapRef.current[node] = sig;
      pending.push({
        node,
        sessionId: sid,
        summary: s.last_summary,
        preview: s.terminal_preview,
        activity: s.activity_snippet,
        status: s.status,
        ts: Date.now(),
      });
    }
    if (!pending.length) return;
    // Legitimate external sync that also has a side effect (POSTs the snapshot to Redis
    // below), gated above by snapRef + the pending-length check so it only fires on a real
    // change. This is what the rule says effects are for, not the "you might not need an
    // effect" case it targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- gated external sync + Redis POST side effect
    setSwarmLogs((prev) => {
      const next = { ...prev };
      for (const s of pending) next[s.node] = s;
      return next;
    });
    void fetch("/api/swarm/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, snapshots: pending }),
    }).catch(() => {});
  }, [sessions, nodeSessions, conductor?.project]);

  // Reframe the board when a panel collapses/expands so it uses the reclaimed space.
  const consoleOpenRef = useRef(consoleOpen);
  const railOpenRef = useRef(railOpen);
  useEffect(() => {
    consoleOpenRef.current = consoleOpen;
    controllerRef.current?.setCopilotOpen(consoleOpen);
  }, [consoleOpen]);
  useEffect(() => {
    railOpenRef.current = railOpen;
    controllerRef.current?.setRailOpen(railOpen);
  }, [railOpen]);

  const onBoardReady = useCallback((editor: Editor, controller: BoardController) => {
    editorRef.current = editor;
    controllerRef.current = controller;
    controller.setCopilotOpen(consoleOpenRef.current);
    controller.setRailOpen(railOpenRef.current);
    // Re-apply the active loop shape after a board remount (conductor switch),
    // so the lane relabels + race column survive the new controller.
    const spec = loopShapeIdRef.current ? LOOP_SHAPES[loopShapeIdRef.current] : undefined;
    if (spec) controller.setLoopShape({ roles: spec.roles, column: spec.column });
  }, []);

  const sendToConductor = useCallback(
    async (message: string) => {
      if (!conductor || !message.trim()) return false;
      const r = await sendCommand({
        project: conductor.project,
        session_id: conductor.session_id,
        message,
      });
      setNote(r.ok ? "sent" : `failed: ${r.error ?? "?"}`);
      return r.ok;
    },
    [conductor],
  );

  // Running an archetype drives the conductor through the real cycle round by round (the loop
  // kernel re-prompts: decompose -> dispatch to sub-agents -> coordinator verifies -> repeat
  // until the archetype's terminate condition). The board shows the tasks (beads) live.
  const runSwarm = useCallback(
    (a: Archetype, goal: string) => {
      if (!conductor || !goal.trim()) return;
      loopRef.current?.stop();
      // Redraw the graph for this loop shape: its return edge (overlay), its lane
      // relabels, and the race's parallel-lane column (the loopShapeId effect).
      setLoopShapeId(a.id);
      // Fresh loop: re-arm the activity log's round/finish dedup, and open the rail so the
      // log is visible as the run happens (the whole point of watching it).
      lastLoggedRoundRef.current = 0;
      loggedFinishRef.current = false;
      setRailOpen(true);
      setNote(`running ${a.name} loop on ${conductor.project}…`);
      swarmCache.log(conductor.project, { kind: "note", text: `${a.name} loop started: ${goal.trim()}` });
      loopRef.current = startArchetypeLoop({
        session: { project: conductor.project, session_id: conductor.session_id },
        archetype: a,
        goal: goal.trim(),
        workers,
        onState: setLoop,
      });
    },
    [conductor, workers],
  );

  const giveSkill = useCallback(
    async (p: SkillPackage) => {
      if (!conductor) return;
      const label = p.display_name ?? p.name;
      setNote(`installing ${label}…`);
      try {
        // Actually install it: download + unzip the SKILL.md into the conductor project's
        // .claude/skills/ so the swarm's sessions discover and run it (no more "hope it installs").
        const res = await fetch("/api/skillvault/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: p.id, dir: conductor.project_dir }),
        });
        const data = (await res.json()) as { ok?: boolean; path?: string; error?: string };
        if (!data.ok) {
          setNote(`install failed: ${data.error ?? "?"}`);
          return;
        }
        setNote(`installed ${label}`);
        swarmCache.log(conductor.project, { kind: "skill", text: `installed skill: ${label}` });
        await sendToConductor(
          `The "${p.id}" skill is now installed in this project's .claude/skills/. Use it (it ` +
            `triggers on its keywords) for relevant work. (${p.tagline ?? p.name})`,
        );
      } catch (e) {
        setNote(`install failed: ${e instanceof Error ? e.message : "?"}`);
      }
    },
    [conductor, sendToConductor],
  );

  // Phase B: spawn dedicated real sessions (validator/improver/workers), each streamable.
  const launchRealSwarm = useCallback(
    async (goal: string) => {
      if (!conductor || spawning || !goal.trim()) return;
      setSpawning(true);
      setNote("spawning real swarm…");
      try {
        const project = conductor.project;
        const map = await spawnSwarm({
          project,
          dir: conductor.project_dir,
          goal: goal.trim(),
          workers,
          onProgress: setNote,
          // Map + tag each node the instant it is alive, so its live terminal is clickable right
          // away instead of after the whole swarm finishes spawning.
          onNode: (node, sid) => {
            setNodeSessions((prev) => ({ ...prev, [node]: sid }));
            swarmCache.setRole(project, sid, node);
          },
        });
        setNodeSessions((prev) => ({ ...prev, ...map }));
        // Tag each spawned session with its node role so it shows as "web · planner" in the
        // picker (not "web #7") and survives a reload.
        for (const [node, sid] of Object.entries(map)) swarmCache.setRole(project, sid, node);
        // Record the whole roster (conductor + workers) so the picker can nest them.
        swarmCache.setSwarm(conductor.session_id, conductor.project, map);
        const keys = Object.keys(map);
        if (keys.length) {
          swarmCache.log(conductor.project, { kind: "note", text: `spawned real swarm: ${keys.join(", ")}` });
          // Kick the conductor to actually orchestrate the spawned teammates (no mocking):
          // decompose -> assign over Agent Mail -> validate with real tests -> improve -> repeat.
          void sendToConductor(conductorBlueprint(goal.trim(), map));
        }
        setNote(
          keys.length ? `spawned + orchestrating: ${keys.join(", ")}` : "spawn failed (check the bridge)",
        );
      } catch (e) {
        setNote(`spawn failed: ${e instanceof Error ? e.message : "?"}`);
      } finally {
        setSpawning(false);
      }
    },
    [conductor, workers, spawning, sendToConductor],
  );

  const sendToWorker = useCallback(
    async (sessionId: string, message: string) => {
      if (!conductor || !message.trim()) return;
      await sendCommand({ project: conductor.project, session_id: sessionId, message });
    },
    [conductor],
  );

  // Tear the swarm down: snapshot every spawned session's log to Redis (so it survives), THEN
  // kill the sessions (frees the processes + clears them from the picker). Logs stay readable.
  const teardownSwarm = useCallback(async () => {
    if (!conductor) return;
    const project = conductor.project;
    const entries = Object.entries(nodeSessions);
    if (!entries.length) {
      setNote("no spawned sessions to clean up");
      return;
    }
    setNote("cleaning up swarm (saving logs first)…");
    // Only snapshot sessions that are actually LIVE. A dead roster entry (a swarm we already
    // killed) would otherwise overwrite a real recorded result with an empty snapshot.
    const snapshots = entries
      .map(([node, sid]) => ({ node, sid, s: sessions.find((x) => x.session_id === sid) }))
      .filter((e): e is { node: string; sid: string; s: VoxSession } => Boolean(e.s))
      .map(({ node, sid, s }) => ({
        node,
        sessionId: sid,
        summary: s.last_summary,
        preview: s.terminal_preview,
        activity: s.activity_snippet,
        status: s.status,
        ts: Date.now(),
      }));
    try {
      await fetch("/api/swarm/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, snapshots }),
      });
    } catch {
      /* the per-node snapshot effect has likely already saved most of this */
    }
    setSwarmLogs((prev) => {
      const next = { ...prev };
      for (const s of snapshots) next[s.node] = s;
      return next;
    });
    // Kill each session: prefer a real kill (frees the process), fall back to deregister.
    for (const [, sid] of entries) {
      const s = sessions.find((x) => x.session_id === sid);
      if (s?.tmux_target) await killSession(s.tmux_target);
      else await fetch(`/api/voxherd/api/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" }).catch(() => {});
    }
    setNodeSessions({});
    setWorkerLines([]);
    swarmCache.removeSwarm(conductor.session_id); // workers are gone; drop the roster (logs persist in Redis)
    swarmCache.clearRoles(conductor.project); // and the role map, so no worker stays pointed at a session
    swarmCache.log(project, { kind: "note", text: `swarm torn down: ${entries.map(([n]) => n).join(", ")} (logs saved)` });
    setNote(`cleaned up ${entries.length} session(s), logs saved`);
  }, [conductor, nodeSessions, sessions]);

  // The goal's requirement: once the loop reports the goal is genuinely met (LOOP_DONE), tear
  // the swarm down automatically, but only on a real "done", not a manual stop or max-rounds.
  useEffect(() => {
    if (loop?.running) {
      torndownRef.current = false; // re-arm for the next run
      return;
    }
    if (loop?.reason === "done" && !torndownRef.current && Object.keys(nodeSessions).length) {
      torndownRef.current = true;
      void teardownSwarm();
    }
  }, [loop?.reason, loop?.running, nodeSessions, teardownSwarm]);

  // Record the loop's round-by-round and finish beats into the persisted run log, so the
  // activity feed shows the loop stepping (and where it stopped) interleaved with the agent
  // work. The loop snapshot carries no history, so log each new round once and the finish once
  // (swarmCache.log itself also dedups consecutive repeats).
  useEffect(() => {
    const project = conductor?.project;
    if (!loop || !project) return;
    if (loop.running && loop.round > lastLoggedRoundRef.current) {
      lastLoggedRoundRef.current = loop.round;
      swarmCache.log(project, {
        kind: "loop",
        text: `${loop.archetype} loop round ${loop.round}/${loop.maxRounds}`,
      });
    }
    if (!loop.running && loop.reason && !loggedFinishRef.current) {
      loggedFinishRef.current = true;
      swarmCache.log(project, { kind: "loop", text: `${loop.archetype} loop ${loop.reason}` });
    }
  }, [loop, conductor?.project]);

  // Unified bead detail: prefer the live task/sub-agent data, fall back to the local cache so
  // a clicked bead still shows what that agent did AFTER the run and across reloads.
  const pid = picked?.id ?? "";
  const liveTask = tasks[pid];
  const liveSub = subDetail[pid];
  const cachedBead = run.beads[pid];
  const detailTitle = liveTask?.subject ?? liveSub?.subject ?? cachedBead?.title ?? `bead ${pid}`;
  const detailIsTask = Boolean(liveTask) || (!liveSub && cachedBead?.kind === "task");
  const detailStatus = liveTask?.status ?? cachedBead?.status ?? (detailIsTask ? "pending" : "");
  // For a sub-agent bead, surface the RESULT the conductor recorded for its worker lane (saved to
  // Redis), so clicking the bead shows what it actually did, not a generic "streams to console" note.
  const laneLog = !detailIsTask && cachedBead?.lane ? swarmLogs[cachedBead.lane] : undefined;
  const laneResult = laneLog
    ? [laneLog.summary, laneLog.preview].filter(Boolean).join("\n\n")
    : undefined;
  const detailBody =
    liveTask?.description ?? laneResult ?? liveSub?.description ?? cachedBead?.result ?? cachedBead?.description;
  const detailFromCache = !liveTask && !liveSub && Boolean(cachedBead);
  const showDetail = Boolean(picked) && (Boolean(liveTask) || Boolean(liveSub) || Boolean(cachedBead));
  // A node's mapped session counts as "live" only if it is still in the sessions list. A stale
  // roster (a swarm we killed) leaves a dead id behind, so without this the inspector would try
  // to stream a dead terminal instead of falling through to the saved Redis log.
  const pickedWorkerSidLive = Boolean(
    pickedWorker && nodeSessions[pickedWorker] && sessions.some((s) => s.session_id === nodeSessions[pickedWorker]),
  );

  // Live loop-shape status for the board overlay (the return edge + gauge):
  // which shape is active, where the loop stands, and the task counts that feed
  // the sweep/dig gauges. Provided via context because tldraw's OnTheCanvas
  // slot (SwarmRoutingEdges) takes no props.
  const loopStatus = useMemo<LoopShapeStatus>(
    () => ({
      id: loopShapeId,
      running: loop?.running ?? false,
      round: loop?.round ?? 0,
      maxRounds: loop?.maxRounds ?? 0,
      reason: loop?.reason ?? "",
      counts,
    }),
    [loopShapeId, loop, counts],
  );

  // The activity log: normalize the swarm's two persistent live sources into one chronological
  // stream (newest first). The run log already carries the conductor's sub-agent dispatches and
  // completions (auto-logged on bead transitions) plus the loop/skill lifecycle; the agent mail
  // carries the inter-agent coordination. Together: "what is going on with all the agents and
  // the mail". Capped so a long run stays light. This is the board's temporal companion.
  const activity = useMemo<ActivityEntry[]>(() => {
    const out: ActivityEntry[] = [];
    run.log.forEach((e, i) => {
      const kind: ActivityEntry["kind"] =
        e.kind === "loop" ? "loop" : e.kind === "spawn" || e.kind === "done" ? "agent" : "run";
      const actor =
        e.agent ?? (e.kind === "loop" ? "loop" : e.kind === "skill" ? "skills" : "swarm");
      out.push({
        id: `log-${e.ts}-${i}`,
        ts: e.ts,
        actor,
        text: e.text,
        kind,
        // Live beats earn the accent: a worker just dispatched, or the loop stepping a round.
        accent: e.kind === "spawn" || (e.kind === "loop" && e.text.includes("round")),
        beadId: e.beadId,
      });
    });
    for (const m of mail) {
      const w = m.subject.match(/worker[\s-]?([1-4])/i) ?? m.from.match(/worker[\s-]?([1-4])/i);
      out.push({
        id: `mail-${m.id}`,
        ts: Date.parse(m.ts) || 0,
        actor: m.from,
        text: m.subject,
        kind: "mail",
        accent: m.importance === "high" || m.importance === "urgent",
        agent: w ? `worker-${w[1]}` : undefined,
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out.slice(0, 80);
  }, [run.log, mail]);

  // A click on an activity row jumps to its subject: a bead opens the inspector (same path as
  // the history tab), an agent (a worker named in a mail) opens its lane inspector.
  const onSelectActivity = useCallback((e: ActivityEntry) => {
    if (e.beadId) setPicked({ id: e.beadId, x: 360, y: 160 });
    else if (e.agent) {
      setConsoleOpen(true);
      setPickedWorker(e.agent);
    }
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas text-ink-mid">
      {/* Full-bleed board */}
      <div className="absolute inset-0">
        {conductor ? (
          <LoopShapeContext.Provider value={loopStatus}>
            <SwarmBoard
              key={conductor.session_id}
              sessionId={conductor.session_id}
              project={conductor.project}
              onReady={onBoardReady}
              onEvent={onBoardEvent}
              workers={workers}
            />
          </LoopShapeContext.Provider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-dim">
            pick a conductor session above to see its live swarm.
          </div>
        )}
      </div>

      {/* Floating header */}
      <div ref={headerRef} className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start p-3">
        <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-raised/80 px-3 py-2 backdrop-blur">
          <Link href="/fleet" className="font-mono text-sm text-ink-dim transition hover:text-ink">
            &larr; fleet
          </Link>
          <span className="font-semibold text-ink">
            Command Center <span className="text-accent">/ swarm</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            conductor
            <SwarmPicker sessions={sessions} value={conductorId} onChange={setConductorId} swarms={swarms} />
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            workers
            <select value={workers} onChange={(e) => setWorkers(Number(e.target.value))} className={SELECT_CLS}>
              {WORKER_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {conductor && (
            <span className="flex items-center gap-1.5 border-l border-line pl-3">
              <input
                value={realGoal}
                onChange={(e) => setRealGoal(e.target.value)}
                placeholder="what should the swarm do?"
                spellCheck={false}
                className={`w-56 rounded-md border bg-canvas/70 px-2 py-1 text-xs text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-accent/60 ${
                  realGoal.trim() ? "border-accent/50 bg-accent/5" : "border-line"
                }`}
              />
              <button
                type="button"
                onClick={() => void launchRealSwarm(realGoal)}
                disabled={spawning || !realGoal.trim()}
                className="rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
                title="spawn dedicated validator, improver, and worker sessions you can stream per node"
              >
                {spawning ? "spawning…" : "+ real swarm"}
              </button>
              {Object.keys(nodeSessions).length > 0 && (
                <button
                  type="button"
                  onClick={() => void teardownSwarm()}
                  className="rounded-md border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-dim transition hover:border-accent/40 hover:text-ink"
                  title="save each session's log to Redis, then kill the spawned sessions"
                >
                  clean up
                </button>
              )}
            </span>
          )}
          {conductor && (
            <span className="flex items-center gap-2 border-l border-line pl-3 font-mono text-[11px] text-ink-dim">
              <span className="text-accent">{counts.working} working</span>
              <span>{counts.queued} queued</span>
              <span>{counts.done} done</span>
            </span>
          )}
          {note && <span className="text-xs text-ink-dim">{note}</span>}
        </div>
      </div>

      {/* Loop status pill, centered below the header so it never collides with the side tabs. */}
      {conductor && loop && (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
          style={{ top: pillTop }}
        >
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-accent/40 bg-raised/90 px-3 py-1 font-mono text-[11px] text-accent shadow backdrop-blur">
            {loop.archetype} loop &middot; round {loop.round}/{loop.maxRounds}
            {loop.reason ? ` · ${loop.reason}` : loop.running ? " · running" : ""}
            {loop.running && (
              <button
                type="button"
                onClick={() => loopRef.current?.stop()}
                className="rounded border border-line px-1.5 text-[10px] text-ink-dim transition hover:text-ink"
              >
                stop
              </button>
            )}
          </span>
        </div>
      )}

      {/* Floating conductor console (collapsible) */}
      {conductor &&
        (consoleOpen ? (
          <aside
            className="absolute bottom-3 left-3 z-20 flex w-[min(330px,calc(100vw-1.5rem))] flex-col rounded-xl border border-line bg-raised/80 p-2 backdrop-blur"
            style={{ top: panelTop }}
          >
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em]">
                <button
                  type="button"
                  onClick={() => setConsoleTab("console")}
                  className={`transition ${consoleTab === "console" ? "text-ink" : "text-ink-dim hover:text-ink"}`}
                >
                  conductor
                </button>
                <span className="text-line">/</span>
                <button
                  type="button"
                  onClick={() => setConsoleTab("history")}
                  className={`transition ${consoleTab === "history" ? "text-accent" : "text-ink-dim hover:text-ink"}`}
                  title="every bead + its result + a timeline, kept locally"
                >
                  history{Object.keys(run.beads).length ? ` (${Object.keys(run.beads).length})` : ""}
                </button>
                <span className="text-line">/</span>
                <button
                  type="button"
                  onClick={() => setConsoleTab("mail")}
                  className={`transition ${consoleTab === "mail" ? "text-accent" : "text-ink-dim hover:text-ink"}`}
                  title="live agent-to-agent coordination, who assigned what to whom"
                >
                  mail{mail.length ? ` (${mail.length})` : ""}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setConsoleOpen(false)}
                className="rounded px-1 text-ink-dim transition hover:text-ink"
                title="collapse"
              >
                &#10216;
              </button>
            </div>
            {consoleTab === "console" ? (
              <>
                <pre
                  ref={termRef}
                  style={{ color: "#d4d4d4" }}
                  className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas/60 p-2 font-mono text-[10px] leading-relaxed"
                >
                  <AnsiLines lines={lines.length ? lines : ["streaming the conductor…"]} />
                </pre>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && input.trim()) {
                      void sendToConductor(input.trim()).then((ok) => ok && setInput(""));
                    }
                  }}
                  placeholder="message the conductor…"
                  spellCheck={false}
                  className="mt-1.5 rounded-lg border border-line bg-canvas/70 px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent/60"
                />
              </>
            ) : consoleTab === "mail" ? (
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-canvas/60 p-2 font-mono text-[10px] leading-relaxed">
                {mail.length === 0 ? (
                  <p className="text-ink-dim">
                    no agent mail yet. When the spawned swarm coordinates (planner assigns, workers
                    claim, the validator verifies) it streams here, live, the other half of the beads.
                  </p>
                ) : (
                  mail.map((m) => (
                    <div key={m.id} className="mb-1 border-b border-line/40 pb-1 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 tabular-nums text-ink-dim opacity-70">{m.ts.slice(11, 16)}</span>
                        <span
                          className={`min-w-0 truncate font-medium ${
                            m.importance === "high" || m.importance === "urgent" ? "text-accent" : "text-ink-mid"
                          }`}
                        >
                          {m.from}
                        </span>
                      </div>
                      <div className="text-ink-mid">{m.subject}</div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-canvas/60 p-2 font-mono text-[10px] leading-relaxed">
                  {Object.keys(run.beads).length === 0 && run.log.length === 0 ? (
                    <p className="text-ink-dim">
                      nothing saved yet. Run a loop and every bead, its result, and a timeline land
                      here. They stay after the run ends and across page reloads.
                    </p>
                  ) : (
                    <>
                      {Object.values(run.beads)
                        .sort((a, b) => b.lastSeen - a.lastSeen)
                        .map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setPicked({ id: b.id, x: 360, y: 140 })}
                            className="mb-0.5 flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-raised/70"
                            title={b.description ?? b.title}
                          >
                            <span className={statusTone(b.status)}>&#9679;</span>
                            <span className="min-w-0 flex-1 truncate text-ink-mid">{b.title}</span>
                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-ink-dim">
                              {b.lane ?? b.kind}
                            </span>
                          </button>
                        ))}
                      {run.log.length > 0 && (
                        <div className="mt-2 space-y-0.5 border-t border-line pt-1.5">
                          {run.log
                            .slice()
                            .reverse()
                            .map((e) => (
                              <div
                                key={`${e.ts}-${e.kind}-${e.text}`}
                                className="flex gap-1.5 text-ink-dim"
                              >
                                <span className="shrink-0 tabular-nums opacity-70">{fmtTime(e.ts)}</span>
                                <span className="min-w-0 flex-1 truncate" title={e.text}>
                                  {e.kind === "done" ? "✓ " : e.kind === "spawn" ? "▸ " : ""}
                                  {e.text}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-dim">
                  <span>{Object.keys(run.beads).length} beads, kept locally</span>
                  <button
                    type="button"
                    onClick={() => conductor && swarmCache.clear(conductor.project)}
                    className="rounded border border-line px-1.5 py-0.5 transition hover:text-ink"
                    title="clear this project's saved history"
                  >
                    clear
                  </button>
                </div>
              </>
            )}
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setConsoleOpen(true)}
            style={{ top: panelTop }}
            className="absolute left-3 z-20 rounded-lg border border-line bg-raised/80 px-2.5 py-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim backdrop-blur transition hover:text-ink"
            title="show the conductor console"
          >
            &#10217; conductor
          </button>
        ))}

      {/* Worker inspector: what this worker is doing (sits right of the conductor console) */}
      {conductor && pickedWorker && (
        <aside
          className="absolute bottom-3 z-20 flex w-[min(320px,calc(100vw-1.5rem))] flex-col rounded-xl border border-accent/40 bg-raised/90 p-3 backdrop-blur"
          style={{ left: consoleOpen ? 352 : 12, top: panelTop }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            {/* Node cycler, in the inspector header: step through the graph (planner ->
                coordinator -> workers -> validator -> improver) without leaving the panel. */}
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => cyclePicked(-1)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-base text-ink-mid transition hover:bg-raised hover:text-ink"
                title="previous node"
              >
                &lsaquo;
              </button>
              <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
                {pickedWorker}
              </span>
              <button
                type="button"
                onClick={() => cyclePicked(1)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-base text-ink-mid transition hover:bg-raised hover:text-ink"
                title="next node"
              >
                &rsaquo;
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPickedWorker(null)}
              className="shrink-0 text-ink-dim transition hover:text-ink"
              title="close"
            >
              &#10005;
            </button>
          </div>
          {pickedWorkerSidLive ? (
            <>
              <pre
                ref={workerTermRef}
                style={{ color: "#d4d4d4" }}
                className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas/60 p-2.5 font-mono text-[10px] leading-relaxed"
              >
                <AnsiLines lines={workerLines.length ? workerLines : [`streaming ${pickedWorker}…`]} />
              </pre>
              <input
                value={workerInput}
                onChange={(e) => setWorkerInput(e.target.value)}
                onKeyDown={(e) => {
                  const sid = nodeSessions[pickedWorker];
                  if (e.key === "Enter" && workerInput.trim() && sid) {
                    void sendToWorker(sid, workerInput.trim());
                    setWorkerInput("");
                  }
                }}
                placeholder={`message ${pickedWorker}…`}
                spellCheck={false}
                className="mt-2 rounded-lg border border-line bg-canvas/70 px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent/60"
              />
            </>
          ) : swarmLogs[pickedWorker] ? (
            <div className="min-h-0 flex-1 space-y-2 overflow-auto">
              <div className="font-mono text-[10px] uppercase tracking-wide text-accent">
                session ended &middot; saved log
              </div>
              {swarmLogs[pickedWorker].summary && (
                <p className="text-[11px] leading-relaxed text-ink-mid">{swarmLogs[pickedWorker].summary}</p>
              )}
              {swarmLogs[pickedWorker].preview && (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas/60 p-2.5 font-mono text-[10px] leading-relaxed text-ink-mid">
                  {swarmLogs[pickedWorker].preview}
                </pre>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-auto">
              {(workerTasks[pickedWorker] ?? []).length === 0 ? (
                <p className="text-[11px] leading-relaxed text-ink-dim">
                  no active task on {pickedWorker} right now. Its work appears here as the
                  conductor assigns tasks to it, click the orange beads in its lane, or hit
                  &quot;+ real swarm&quot; to give every node its own live session.
                </p>
              ) : (
                (workerTasks[pickedWorker] ?? []).map((id) => {
                  const t = tasks[id];
                  return (
                    <div key={id} className="rounded-lg border border-line bg-canvas/50 p-2">
                      <div className="text-xs font-semibold text-ink">
                        {t?.subject ?? `task ${id}`}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
                        {(t?.status ?? "in progress").replace(/_/g, " ")} &middot; {id}
                      </div>
                      {t?.description && (
                        <p className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-mid">
                          {t.description}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </aside>
      )}

      {/* Floating archetype + skills rail (collapsible) */}
      {conductor &&
        (railOpen ? (
          <aside
            className="absolute bottom-3 right-3 z-20 flex w-[min(350px,calc(100vw-1.5rem))] flex-col rounded-xl border border-line bg-raised/80 p-4 backdrop-blur"
            style={{ top: panelTop }}
          >
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                className="rounded px-1 text-ink-dim transition hover:text-ink"
                title="collapse"
              >
                &#10217;
              </button>
            </div>
            <ArchetypeRail onRun={runSwarm} disabled={!conductor} goal={realGoal} defaultOpen={false} />
            {/* Activity log: the swarm's running narrative (sub-agent dispatches + completions,
                agent mail, the loop stepping), newest first. The temporal companion to the
                board, so it gets the prime space in the rail. */}
            <div
              className={`mt-4 flex flex-col border-t border-line pt-3 ${
                activityOpen ? "min-h-0 flex-[3]" : "shrink-0"
              }`}
            >
              <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CollapseButton
                    open={activityOpen}
                    onClick={() => setActivityOpen((o) => !o)}
                    label="activity"
                  />
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-dim">
                    activity
                  </span>
                </div>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-dim">
                  {loop?.running && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-accent"
                      style={{ animation: "gb-pulse 1.1s ease-in-out infinite" }}
                    />
                  )}
                  {activity.length || ""}
                </span>
              </div>
              {activityOpen && <ActivityFeed entries={activity} onSelect={onSelectActivity} />}
            </div>
            <div className="mt-4 flex min-h-0 flex-[2] flex-col border-t border-line pt-3">
              <SkillsMenu onGive={giveSkill} disabled={!conductor} />
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            style={{ top: panelTop }}
            className={`absolute right-3 z-20 flex items-center gap-1.5 rounded-lg border bg-raised/80 px-2.5 py-2 font-mono text-[11px] uppercase tracking-wider text-accent backdrop-blur transition hover:text-ink ${
              realGoal.trim() || loop?.running ? "border-accent/50 ring-1 ring-accent/20" : "border-line"
            }`}
            title="show the activity log, loop shapes + skills"
          >
            {loop?.running && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-accent"
                style={{ animation: "gb-pulse 1.1s ease-in-out infinite" }}
              />
            )}
            activity + loops &#10216;
          </button>
        ))}

      {/* Detail card: click a bead (a task or a sub-agent), live OR from the saved history. */}
      {showDetail && picked && (
        <div
          className="fixed z-30 w-[340px] rounded-xl border border-line bg-raised/95 p-3 shadow-xl backdrop-blur"
          style={{
            left: Math.min(picked.x, (typeof window !== "undefined" ? window.innerWidth : 1280) - 360),
            top: Math.min(picked.y + 10, (typeof window !== "undefined" ? window.innerHeight : 800) - 280),
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{detailTitle}</span>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="shrink-0 text-ink-dim transition hover:text-ink"
              title="close"
            >
              &#10005;
            </button>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-accent">
            {detailIsTask
              ? `${(detailStatus || "pending").replace(/_/g, " ")} · task ${pid}`
              : `sub-agent · ${detailStatus ? detailStatus.replace(/_/g, " ") : "ran inside the conductor"}`}
          </div>
          <p className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-mid">
            {detailBody ??
              (detailIsTask
                ? "No detail recorded yet. When the coordinator closes this task it records the result here."
                : "A Task-tool sub-agent of the conductor. Its full output streams into the conductor console on the left while it runs. (For an agent with its own clickable terminal, use + real swarm.)")}
          </p>
          {detailFromCache && (
            <div className="mt-2 border-t border-line pt-1.5 font-mono text-[10px] text-ink-dim">
              from saved history &middot; kept locally, persists after the run
            </div>
          )}
        </div>
      )}

      {/* Zoom controls, centered within the graph area between the side panels (see above). */}
      {conductor && (
        <div
          className="pointer-events-none absolute bottom-4 z-20 flex justify-center transition-[left,right] duration-300"
          style={{ left: consoleOpen ? 350 : 12, right: railOpen ? 362 : 12 }}
        >
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-raised/80 p-1 backdrop-blur">
          <button
            type="button"
            onClick={() => editorRef.current?.zoomOut()}
            className="h-7 w-7 rounded text-base text-ink-mid transition hover:bg-raised hover:text-ink"
            title="zoom out"
          >
            &minus;
          </button>
          <button
            type="button"
            onClick={() => controllerRef.current?.frameCamera()}
            className="rounded px-2 py-1 text-[11px] font-medium text-ink-mid transition hover:bg-raised hover:text-ink"
            title="fit to view"
          >
            fit
          </button>
          <button
            type="button"
            onClick={() => editorRef.current?.zoomIn()}
            className="h-7 w-7 rounded text-base text-ink-mid transition hover:bg-raised hover:text-ink"
            title="zoom in"
          >
            +
          </button>
        </div>
        </div>
      )}
    </div>
  );
}
