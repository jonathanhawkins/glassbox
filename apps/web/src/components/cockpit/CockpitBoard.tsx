"use client";

// The Glassbox glass-cockpit. Mounts tldraw read-only and programmatic, wires
// the BoardController, and subscribes ONCE to the live SSE event stream. All
// chrome (top bar, curve, controls, legend, ticker) is HTML overlaid on the
// locked canvas. This file is client-only and must be loaded via next/dynamic
// with { ssr: false } because tldraw touches window.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Tldraw, type Editor, type TLComponents } from "tldraw";
import "tldraw/tldraw.css";

import type { GlassboxEvent } from "@glassbox/contract";
import { toMail, type MailMessage, type SkillState } from "@/lib/cockpit/types";
import { DEFAULT_TASK, TASK_GOALS, type TaskName } from "@/lib/cockpit/tasks";
import { ActiveTaskProvider } from "@/lib/cockpit/ActiveTaskContext";

import { BoardController } from "@/lib/cockpit/board";
import { RoutingEdges } from "@/lib/cockpit/RoutingEdges";
import { AgentShapeUtil, BeadShapeUtil, DockShapeUtil } from "@/lib/cockpit/shapes";

import { CorrectnessCurve } from "./CorrectnessCurve";
import { EventsTicker } from "./EventsTicker";
import { LaunchControls } from "./LaunchControls";
import { AgentMailDrawer } from "./AgentMailDrawer";
import { Legend } from "./Legend";
import { PlannerSkillPanel } from "./PlannerSkillPanel";

// The CopilotKit command bar is client-only (GraphQL client + chat widget that
// touch the browser), so it is loaded with { ssr: false }. The board + buttons
// remain a fully working fallback if the chat is still booting.
const CockpitCopilot = dynamic(() => import("./CockpitCopilot"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-xs text-slate-600">
      booting copilot...
    </div>
  ),
});

const MAX_TICKER = 60;
// Cap the in-session mail buffer; full history rehydrates from /api/mail on load.
const MAX_MAIL = 500;

// Custom shape utils, defined once outside render (tldraw requires a stable ref).
const SHAPE_UTILS = [AgentShapeUtil, DockShapeUtil, BeadShapeUtil];

// Hide all default tldraw chrome and draw our routing edges on the canvas.
const TL_COMPONENTS: TLComponents = {
  Background: () => null,
  Grid: () => null,
  OnTheCanvas: RoutingEdges,
  // Null out everything interactive / decorative we do not want.
  Toolbar: null,
  StylePanel: null,
  PageMenu: null,
  NavigationPanel: null,
  MainMenu: null,
  HelpMenu: null,
  ZoomMenu: null,
  QuickActions: null,
  ActionsMenu: null,
  ContextMenu: null,
  HelperButtons: null,
  DebugPanel: null,
  DebugMenu: null,
  MenuPanel: null,
  TopPanel: null,
  SharePanel: null,
  KeyboardShortcutsDialog: null,
  Minimap: null,
};

export default function CockpitBoard() {
  const controllerRef = useRef<BoardController | null>(null);
  // The active build target. Owned here so the launch controls, the curve, and
  // the planner-skill strip all run against (and refetch for) the same task.
  const [activeTask, setActiveTask] = useState<TaskName>(DEFAULT_TASK);
  // Bumped once the controller mounts so the per-task hydration effect (below)
  // can run against it (and re-run on every task switch).
  const [controllerReady, setControllerReady] = useState(0);
  const [goal, setGoal] = useState<string>(TASK_GOALS[DEFAULT_TASK]);
  const [version, setVersion] = useState<number>(1);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [events, setEvents] = useState<GlassboxEvent[]>([]);
  const [sseOpen, setSseOpen] = useState(false);
  const [skill, setSkill] = useState<SkillState | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(true);
  // Reframe the board when the copilot collapses or expands so the planner lane
  // is never hidden under the panel (and the board fills the width when hidden).
  useEffect(() => {
    controllerRef.current?.setCopilotOpen(copilotOpen);
  }, [copilotOpen]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailUnread, setMailUnread] = useState(0);
  // Read inside the SSE callback (which closes over initial state) to decide
  // whether an arriving message should bump the unread badge.
  const mailOpenRef = useRef(false);

  const handleMount = useCallback((editor: Editor) => {
    const controller = new BoardController(editor);
    controller.onGoal = (g) => setGoal(g);
    controller.onPlannerVersion = (v) => setVersion(v);
    controller.onFinished = (a) => setAccuracy(a);
    controller.onSkill = (s) => setSkill(s);
    controller.layout();
    controllerRef.current = controller;
    // Signal the per-task hydration effect that the controller exists. The
    // leaderboard + skill hydration lives there (keyed on activeTask) so it
    // re-runs for the right task on load and on every switch.
    setControllerReady((n) => n + 1);

    // Hydrate the existing board (task-independent) so a reload mid-run is not
    // blank. The curve + skill are hydrated per task in the effect below.
    void (async () => {
      try {
        const res = await fetch("/api/beads", { cache: "no-store" });
        const snapshot = await res.json();
        controller.hydrateBeads(snapshot);
      } catch {
        // empty board is fine
      }
      // Hydrate the full mail thread once. Assumes the live SSE is forward-only
      // (it tails new events from "$"), so hydrate and live never overlap and no
      // per-message de-dup is needed. If the SSE is ever switched to replay from
      // 0, carry the stream-id into MailMessage and de-dup here.
      try {
        const res = await fetch("/api/mail", { cache: "no-store" });
        const rows = (await res.json()) as MailMessage[];
        if (Array.isArray(rows) && rows.length) {
          setMessages(rows.slice(-MAX_MAIL));
        }
      } catch {
        // no mail yet is fine
      }
    })();

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  // Hydrate the curve readout + planner-skill strip for the ACTIVE task: on mount
  // (once the controller exists) and again whenever the task switches. Fetches the
  // task's leaderboard (last row -> header version/accuracy) and its skill mirror
  // (order/unit/covered -> which tiles render and their coverage), so switching
  // tasks immediately reframes the strip to the new task's groups instead of
  // carrying the previous task's coverage. The live SSE then keeps it climbing.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    // Reflect the active task's goal in the header immediately on switch (the SSE
    // onGoal later overrides it once a run emits its goal).
    setGoal(TASK_GOALS[activeTask]);
    let cancelled = false;
    void (async () => {
      let lastVersion = 1;
      let lastAccuracy: number | null = null;
      try {
        const res = await fetch(
          `/api/leaderboard?task=${encodeURIComponent(activeTask)}`,
          { cache: "no-store" },
        );
        const rows = (await res.json()) as { version: number; accuracy: number }[];
        if (!cancelled && Array.isArray(rows) && rows.length) {
          const last = rows[rows.length - 1];
          lastVersion = last.version;
          lastAccuracy = last.accuracy;
          setVersion(last.version);
          setAccuracy(last.accuracy);
        } else if (!cancelled) {
          // No runs for this task yet: reset the header so it does not show the
          // previous task's score.
          setVersion(1);
          setAccuracy(null);
        }
      } catch {
        // no curve yet is fine
      }
      try {
        const res = await fetch(
          `/api/skill?task=${encodeURIComponent(activeTask)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          covered?: string[];
          order?: string[];
          unit?: string;
        };
        if (cancelled) return;
        const covered = Array.isArray(data?.covered) ? data.covered : [];
        const order = Array.isArray(data?.order) ? data.order : undefined;
        controller.hydrateSkill(covered, lastVersion, lastAccuracy, order, data?.unit);
      } catch {
        // no skill snapshot yet is fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTask, controllerReady]);

  // Single EventSource subscription for the whole board.
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.onopen = () => setSseOpen(true);
      es.onmessage = (e) => {
        let ev: GlassboxEvent | null = null;
        try {
          ev = JSON.parse(e.data) as GlassboxEvent;
        } catch {
          return;
        }
        controllerRef.current?.apply(ev);
        const mail = toMail(ev);
        if (mail) {
          // Mail goes to the drawer, not the ticker. Accumulate (full history
          // rehydrates from /api/mail) and bump the badge while the drawer is shut.
          setMessages((prev) => {
            const next = [...prev, mail];
            return next.length > MAX_MAIL ? next.slice(next.length - MAX_MAIL) : next;
          });
          if (!mailOpenRef.current) setMailUnread((n) => n + 1);
          return;
        }
        setEvents((prev) => {
          const next = [ev as GlassboxEvent, ...prev];
          return next.length > MAX_TICKER ? next.slice(0, MAX_TICKER) : next;
        });
      };
      es.onerror = () => {
        setSseOpen(false);
        // EventSource auto-reconnects, but if it hard-closes, reconnect manually.
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          es.close();
          es = null;
          retry = setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (es) es.close();
    };
  }, []);

  // Mirror mailOpen into a ref for the SSE callback (which closes over initial
  // state and reads the live value from the ref).
  useEffect(() => {
    mailOpenRef.current = mailOpen;
  }, [mailOpen]);

  // Clear the unread badge the moment the drawer opens. Done as a render-phase
  // reset on the closed -> open transition (the React-recommended "adjust state
  // on prop/state change" pattern) instead of a setState inside an effect.
  const [mailWasOpen, setMailWasOpen] = useState(false);
  if (mailWasOpen !== mailOpen) {
    setMailWasOpen(mailOpen);
    if (mailOpen) setMailUnread(0);
  }

  return (
    <ActiveTaskProvider value={activeTask}>
    <div className="relative h-full w-full overflow-hidden bg-[#060a14]">
      {/* The locked, programmatic tldraw canvas. */}
      <div className="absolute inset-0">
        <Tldraw
          shapeUtils={SHAPE_UTILS}
          components={TL_COMPONENTS}
          hideUi
          onMount={handleMount}
          autoFocus={false}
        />
      </div>

      {/* Vignette + grid wash so the board reads as a cockpit, over the canvas. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,rgba(34,211,238,0.06),transparent_60%)]" />

      {/* Top bar overlay. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-5">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
              Glassbox
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                sseOpen
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${sseOpen ? "bg-emerald-400" : "bg-amber-400"}`}
              />
              {sseOpen ? "live" : "connecting"}
            </span>
          </div>
          <p className="mt-1 max-w-xl text-xs text-slate-400">
            watch a self-improving swarm build real code, graded against ground truth
          </p>
          <p className="mt-1 max-w-xl truncate text-[11px] text-slate-500">
            goal: {goal}
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMailOpen(true)}
            title="Agent Mail: the swarm's conversation"
            className="relative rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5 text-center backdrop-blur transition-colors hover:bg-cyan-500/10"
          >
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
              agent mail
            </div>
            <div className="text-sm font-semibold text-cyan-300">inbox</div>
            {mailUnread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {mailUnread > 99 ? "99+" : mailUnread}
              </span>
            )}
          </button>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-center backdrop-blur">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
              planner
            </div>
            <div className="text-lg font-semibold tabular-nums text-violet-300">
              v{version}
            </div>
          </div>
          <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/5 px-4 py-1.5 text-center backdrop-blur">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
              accuracy
            </div>
            <div className="text-2xl font-bold tabular-nums text-cyan-300">
              {accuracy === null ? "--" : `${(accuracy * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>
      </header>

      {/* Left rail: the CopilotKit command bar gets the whole column so the chat
          has room to think (generative UI, the approval card, the curve render
          inline) instead of being squeezed between the curve and the feed. */}
      <aside
        className={`pointer-events-none absolute bottom-5 left-5 top-28 z-20 flex flex-col gap-3 ${
          copilotOpen ? "w-[360px]" : "w-auto"
        }`}
      >
        {copilotOpen ? (
          <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cyan-500/25 bg-slate-950/70 backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-800/70 px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-300/90">
                copilot
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] text-cyan-300/90">
                  live
                </span>
                <button
                  type="button"
                  onClick={() => setCopilotOpen(false)}
                  title="Collapse the copilot to see the graph"
                  className="rounded-md border border-slate-700/60 bg-slate-900/60 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
                >
                  hide
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <CockpitCopilot />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCopilotOpen(true)}
            title="Expand the copilot"
            className="pointer-events-auto flex items-center gap-2 self-start rounded-2xl border border-cyan-500/25 bg-slate-950/70 px-3 py-2 backdrop-blur transition hover:bg-slate-900/70"
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-300/90">
              copilot
            </span>
            <span className="text-[11px] text-cyan-300/90">show</span>
          </button>
        )}
      </aside>

      {/* Right rail: the money-shot curve up top, the operator controls + legend
          (the chat's manual fallback), and the live event strip filling the rest. */}
      <aside className="pointer-events-none absolute bottom-5 right-5 top-28 z-20 flex w-[360px] flex-col gap-3">
        <div className="pointer-events-auto h-[200px] shrink-0 rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <CorrectnessCurve activeTask={activeTask} />
        </div>
        <div className="pointer-events-auto shrink-0 rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <LaunchControls activeTask={activeTask} onTaskChange={setActiveTask} />
        </div>
        <div className="pointer-events-auto shrink-0 rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <Legend />
        </div>
        {/* Compact live event strip fills the remaining rail height. */}
        <div className="pointer-events-auto min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <EventsTicker events={events} />
        </div>
      </aside>

      {/* Planner skill evolution strip: the self-improvement made visible. */}
      {skill && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 w-[min(560px,44vw)] -translate-x-1/2">
          <PlannerSkillPanel skill={skill} activeTask={activeTask} />
        </div>
      )}

      {/* Agent Mail: the swarm's conversation, grouped by planner version. */}
      <AgentMailDrawer
        open={mailOpen}
        messages={messages}
        onClose={() => setMailOpen(false)}
      />
    </div>
    </ActiveTaskProvider>
  );
}
