"use client";

// The Glassbox glass-cockpit. Mounts tldraw read-only and programmatic, wires
// the BoardController, and subscribes ONCE to the live SSE event stream. All
// chrome (top bar, curve, controls, legend, ticker) is HTML overlaid on the
// locked canvas. This file is client-only and must be loaded via next/dynamic
// with { ssr: false } because tldraw touches window.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Tldraw, type Editor, type TLComponents } from "tldraw";
import "tldraw/tldraw.css";

import type { GlassboxEvent } from "@glassbox/contract";
import { toMail, type MailMessage, type SkillState } from "@/lib/cockpit/types";
import { DEFAULT_TASK, defaultGoalFor, type TaskName } from "@/lib/cockpit/tasks";
import { ActiveTaskProvider } from "@/lib/cockpit/ActiveTaskContext";

import { BoardController } from "@/lib/cockpit/board";
import { RoutingEdges } from "@/lib/cockpit/RoutingEdges";
import { AgentShapeUtil, BeadShapeUtil, DockShapeUtil } from "@/lib/cockpit/shapes";

import { OptimizePanel } from "./OptimizePanel";
import { LaunchControls } from "./LaunchControls";
import { ControlPanel } from "./ControlPanel";
import { Legend } from "./Legend";
import { PlannerSkillPanel } from "./PlannerSkillPanel";
import { CollapseButton } from "./CollapseButton";
import { BeadInspector, type InspectState } from "./BeadInspector";

// The CopilotKit command bar is client-only (GraphQL client + chat widget that
// touch the browser), so it is loaded with { ssr: false }. The board + buttons
// remain a fully working fallback if the chat is still booting.
const CockpitCopilot = dynamic(() => import("./CockpitCopilot"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-xs text-ink-dim">
      booting chat...
    </div>
  ),
});

// The secondary rail panels are not needed for first interactive paint, so they
// are code-split out of the initial cockpit chunk and loaded on demand. The curve
// in particular pulls in recharts (~120KB gz); lazy-loading it keeps recharts off
// the critical path to the live tldraw board. ssr:false because this whole tree
// is client-only (CockpitBoard is itself mounted via dynamic ssr:false).
const CorrectnessCurve = dynamic(
  () => import("./CorrectnessCurve").then((m) => m.CorrectnessCurve),
  { ssr: false },
);
const LeaderboardPanel = dynamic(
  () => import("./LeaderboardPanel").then((m) => m.LeaderboardPanel),
  { ssr: false },
);
const EventsTicker = dynamic(
  () => import("./EventsTicker").then((m) => m.EventsTicker),
  { ssr: false },
);
// The mail + code drawers only render in response to an operator click (their
// open state starts false), so they are code-split out of the initial cockpit
// chunk. The chunks load client-side after hydration, so by the time the
// operator opens a drawer it is ready and still slides in. loading:()=>null
// because a closed drawer renders nothing visible anyway.
const AgentMailDrawer = dynamic(
  () => import("./AgentMailDrawer").then((m) => m.AgentMailDrawer),
  { ssr: false, loading: () => null },
);
const CodeDrawer = dynamic(
  () => import("./CodeDrawer").then((m) => m.CodeDrawer),
  { ssr: false, loading: () => null },
);

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
  const [goal, setGoal] = useState<string>(defaultGoalFor(DEFAULT_TASK));
  const [version, setVersion] = useState<number>(1);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [events, setEvents] = useState<GlassboxEvent[]>([]);
  const [sseOpen, setSseOpen] = useState(false);
  const [skill, setSkill] = useState<SkillState | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(true);
  // The event feed collapses to its header like the panels above it. Its state
  // lives here (not inside EventsTicker) so the rail container can drop its
  // flex-1 stretch and shrink to the header when the feed is hidden.
  const [eventsOpen, setEventsOpen] = useState(true);
  // The whole right rail (controls, curve, leaderboard, optimize, feed, legend)
  // collapses to a single edge tab so the operator can hand the full width to the
  // graph. State lives here so the rail container can swap to the tab and the
  // board can reframe into the reclaimed space.
  const [railOpen, setRailOpen] = useState(true);
  // Reframe the board when the copilot collapses or expands so the planner lane
  // is never hidden under the panel (and the board fills the width when hidden).
  useEffect(() => {
    controllerRef.current?.setCopilotOpen(copilotOpen);
  }, [copilotOpen]);
  // Reframe the board when the right rail collapses or expands so the graph uses
  // the reclaimed width (and nothing hides under the rail when it is open).
  useEffect(() => {
    controllerRef.current?.setRailOpen(railOpen);
  }, [railOpen]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [mailOpen, setMailOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  // The task-inspector popover: set when an operator clicks a bead, carrying its
  // resolved detail and the click point so the card anchors near the bead.
  const [inspect, setInspect] = useState<InspectState | null>(null);
  const [mailUnread, setMailUnread] = useState(0);
  // The SSE stream fires ~10x/sec. Its list updates (events feed, mail buffer,
  // unread badge) are non-urgent, so they run inside startTransition: React can
  // interrupt them to keep clicks, drags, and the tldraw canvas responsive (INP).
  const [, startTransition] = useTransition();
  // Read inside the SSE callback (which closes over initial state) to decide
  // whether an arriving message should bump the unread badge.
  const mailOpenRef = useRef(false);
  // The single SSE subscription (deps []) closes over the initial activeTask, so
  // mirror the live value here. The stream is global (every task's events ride
  // glassbox:events) but the board, curve, and leaderboard are per-task, so the
  // callback drops any event not stamped with the active task.
  const activeTaskRef = useRef<TaskName>(activeTask);
  useEffect(() => {
    activeTaskRef.current = activeTask;
  }, [activeTask]);

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
    // The board snapshot and the full mail thread are independent, so fetch them
    // in parallel instead of serially: a reload mid-run paints both about one
    // round-trip sooner. Each settles on its own; one failing leaves the other.
    void Promise.all([
      (async () => {
        try {
          const res = await fetch("/api/beads", { cache: "no-store" });
          const snapshot = await res.json();
          controller.hydrateBeads(snapshot);
        } catch {
          // empty board is fine
        }
      })(),
      // Hydrate the full mail thread once. Assumes the live SSE is forward-only
      // (it tails new events from "$"), so hydrate and live never overlap and no
      // per-message de-dup is needed. If the SSE is ever switched to replay from
      // 0, carry the stream-id into MailMessage and de-dup here.
      (async () => {
        try {
          const res = await fetch("/api/mail", { cache: "no-store" });
          const rows = (await res.json()) as MailMessage[];
          if (Array.isArray(rows) && rows.length) {
            setMessages(rows.slice(-MAX_MAIL));
          }
        } catch {
          // no mail yet is fine
        }
      })(),
    ]);

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
    setGoal(defaultGoalFor(activeTask));
    let cancelled = false;
    void (async () => {
      let lastVersion = 1;
      let lastAccuracy: number | null = null;
      // The leaderboard and the skill mirror are two independent endpoints, so
      // fire both requests up front and let them fly in parallel instead of
      // waiting for the leaderboard round-trip before even asking for the skill
      // (saves ~one round-trip per task switch). Processing order is preserved:
      // the skill hydration still consumes the version/accuracy the leaderboard
      // yields. allSettled so one endpoint failing never rejects the other.
      const [lbRes, skRes] = await Promise.allSettled([
        fetch(`/api/leaderboard?task=${encodeURIComponent(activeTask)}`, {
          cache: "no-store",
        }).then((r) => r.json() as Promise<{ version: number; accuracy: number }[]>),
        fetch(`/api/skill?task=${encodeURIComponent(activeTask)}`, {
          cache: "no-store",
        }).then(
          (r) =>
            r.json() as Promise<{
              covered?: string[];
              order?: string[];
              unit?: string;
            }>,
        ),
      ]);
      if (cancelled) return;
      if (lbRes.status === "fulfilled") {
        const rows = lbRes.value;
        if (Array.isArray(rows) && rows.length) {
          const last = rows[rows.length - 1];
          lastVersion = last.version;
          lastAccuracy = last.accuracy;
          setVersion(last.version);
          setAccuracy(last.accuracy);
        } else {
          // No runs for this task yet: reset the header so it does not show the
          // previous task's score.
          setVersion(1);
          setAccuracy(null);
        }
      }
      // A leaderboard fetch error leaves the header as-is (matches prior behavior).
      if (skRes.status === "fulfilled" && skRes.value) {
        const data = skRes.value;
        const covered = Array.isArray(data.covered) ? data.covered : [];
        const order = Array.isArray(data.order) ? data.order : undefined;
        controller.hydrateSkill(covered, lastVersion, lastAccuracy, order, data.unit);
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
        // Per-task board over a global stream: drop events for any other task.
        // Pre-multi-task events carry no task; treat those as the default task
        // so an older swarm still drives the tokenizer board.
        const evTask = (ev.task ?? DEFAULT_TASK) as TaskName;
        if (evTask !== activeTaskRef.current) return;
        // The board update is the urgent visual, so apply it to tldraw
        // synchronously. The React list updates below are non-urgent and run in a
        // transition so a burst of events cannot block interaction (INP).
        controllerRef.current?.apply(ev);
        const mail = toMail(ev);
        if (mail) {
          // Mail goes to the drawer, not the ticker. Accumulate (full history
          // rehydrates from /api/mail) and bump the badge while the drawer is shut.
          startTransition(() => {
            setMessages((prev) => {
              const next = [...prev, mail];
              return next.length > MAX_MAIL ? next.slice(next.length - MAX_MAIL) : next;
            });
            if (!mailOpenRef.current) setMailUnread((n) => n + 1);
          });
          return;
        }
        startTransition(() => {
          setEvents((prev) => {
            const next = [ev as GlassboxEvent, ...prev];
            return next.length > MAX_TICKER ? next.slice(0, MAX_TICKER) : next;
          });
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

  // A bead dispatches a window event when clicked (it lives inside tldraw's
  // locked shape tree, so it cannot call into React directly). Resolve its live
  // task detail from the controller and open the inspector popover at the click.
  useEffect(() => {
    const onBeadClick = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { beadId?: string; x?: number; y?: number }
        | undefined;
      const controller = controllerRef.current;
      if (!controller || !detail?.beadId) return;
      const d = controller.beadDetail(detail.beadId);
      if (d) setInspect({ detail: d, x: detail.x ?? 0, y: detail.y ?? 0 });
    };
    window.addEventListener("glassbox:bead-click", onBeadClick);
    return () => window.removeEventListener("glassbox:bead-click", onBeadClick);
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
    <div className="relative h-full w-full overflow-hidden bg-canvas">
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,rgba(255,255,255,0.02),transparent_60%)]" />

      {/* Top bar overlay. The transport panel is absolutely centered so it sits
          dead center regardless of how wide the title / readout clusters get. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-5">
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2">
          <ControlPanel activeTask={activeTask} goal={goal} />
        </div>
        <div className="pointer-events-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Glassbox
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium ${
                sseOpen
                  ? "border-pass/40 bg-pass/10 text-pass"
                  : "border-line bg-white/[0.04] text-ink-mid"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${sseOpen ? "bg-pass" : "bg-ink-dim"}`}
              />
              {sseOpen ? "live" : "connecting"}
            </span>
          </div>
          <p className="mt-1 max-w-xl text-xs text-ink-mid">
            watch a self-improving swarm build real code, graded against ground truth
          </p>
          <p className="mt-1 max-w-xl truncate text-[11px] text-ink-dim">
            goal: {goal}
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMailOpen(true)}
            title="Agent Mail: the swarm's conversation"
            className="relative rounded-xl border border-accent/30 bg-accent/5 px-3 py-1.5 text-center backdrop-blur transition-colors hover:bg-accent/10"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">
              agent mail
            </div>
            <div className="text-sm font-semibold text-accent">inbox</div>
            {mailUnread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-fail px-1 text-[9px] font-bold text-white">
                {mailUnread > 99 ? "99+" : mailUnread}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setCodeOpen(true)}
            title="Workspace code: the real source the swarm wrote, version by version"
            className="rounded-xl border border-line bg-white/[0.04] px-3 py-1.5 text-center backdrop-blur transition-colors hover:bg-raised"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">
              code
            </div>
            <div className="text-sm font-semibold text-ink-mid">source</div>
          </button>
          <div className="rounded-xl border border-line bg-raised/70 px-3 py-1.5 text-center backdrop-blur">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">
              planner
            </div>
            <div className="text-lg font-semibold tabular-nums text-ink-mid">
              v{version}
            </div>
          </div>
          <div className="rounded-xl border border-accent/40 bg-accent/5 px-4 py-1.5 text-center backdrop-blur">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">
              accuracy
            </div>
            <div className="text-2xl font-bold tabular-nums text-accent">
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
          <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-accent/25 bg-panel/70 backdrop-blur">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <div className="flex items-center gap-2">
                <CollapseButton
                  open={copilotOpen}
                  onClick={() => setCopilotOpen(false)}
                  label="chat"
                />
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-accent/90">
                  chat
                </span>
              </div>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[9px] text-accent/90">
                live
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <CockpitCopilot />
            </div>
          </div>
        ) : (
          <div className="pointer-events-auto flex items-center gap-2 self-start rounded-lg border border-accent/25 bg-panel/70 px-3 py-2 backdrop-blur">
            <CollapseButton
              open={copilotOpen}
              onClick={() => setCopilotOpen(true)}
              label="chat"
            />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-accent/90">
              chat
            </span>
          </div>
        )}
      </aside>

      {/* Right rail: operator controls on top, then the live event strip filling
          the rest, followed by the money-shot curve, the leaderboard, the optimise
          panel, and the color legend pinned at the foot. The event feed minimizes
          to its header when collapsed. The whole rail collapses to an edge tab
          (setRailOpen reframes the board into the reclaimed width). */}
      <aside
        className={`pointer-events-none absolute bottom-5 right-5 top-28 z-20 flex flex-col gap-3 ${
          railOpen ? "w-[360px]" : "w-auto items-end"
        }`}
      >
        {railOpen ? (
          // One container holds every panel as a hairline-divided section, so the
          // rail reads as a single surface (not a stack of floating cards). The
          // event feed section flexes to fill the leftover height.
          <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel/70 backdrop-blur">
            <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-ink-mid">
                panels
              </span>
              <CollapseButton
                open={railOpen}
                onClick={() => setRailOpen(false)}
                label="panels"
              />
            </div>
            {/* The body scrolls so every panel stays reachable even when the rail
                is taller than the viewport. The panels header above stays pinned. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="shrink-0 border-b border-line p-3">
                <LaunchControls activeTask={activeTask} onTaskChange={setActiveTask} />
              </div>
              {/* Compact live event strip with a default height and its own scroll
                  (or shrinks to its header when collapsed). */}
              <div
                className={`overflow-hidden border-b border-line p-3 ${
                  eventsOpen ? "h-[200px] shrink-0" : "shrink-0"
                }`}
              >
                <EventsTicker
                  events={events}
                  open={eventsOpen}
                  onToggle={() => setEventsOpen((o) => !o)}
                />
              </div>
              <div className="shrink-0 border-b border-line p-3">
                <CorrectnessCurve activeTask={activeTask} />
              </div>
              <div className="shrink-0 border-b border-line p-3">
                <LeaderboardPanel activeTask={activeTask} />
              </div>
              <div className="shrink-0 border-b border-line p-3">
                <OptimizePanel events={events} />
              </div>
              <div className="shrink-0 p-3">
                <Legend activeTask={activeTask} />
              </div>
            </div>
          </div>
        ) : (
          <div className="pointer-events-auto flex items-center gap-2 self-end rounded-lg border border-line bg-panel/70 px-3 py-2 backdrop-blur">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-ink-mid">
              panels
            </span>
            <CollapseButton
              open={railOpen}
              onClick={() => setRailOpen(true)}
              label="panels"
            />
          </div>
        )}
      </aside>

      {/* Planner skill evolution strip: the self-improvement made visible.
          Instead of pinning to the viewport center, the strip centers within the
          board region BETWEEN the rails: it spans from the left rail's inner edge
          (or the screen edge when the chat is minimized) to the right rail's inner
          edge, then centers the panel inside that span. So when the chat collapses
          to its tab, the strip re-centers over the graph instead of drifting right.
          With both rails open this reproduces the old centered position. */}
      {skill && (
        <div
          className={`pointer-events-none absolute bottom-5 z-20 flex justify-center transition-[left,right] duration-300 ${
            copilotOpen ? "left-[380px]" : "left-5"
          } ${railOpen ? "right-[380px]" : "right-5"}`}
        >
          <div className="w-[min(560px,44vw)]">
            <PlannerSkillPanel skill={skill} activeTask={activeTask} />
          </div>
        </div>
      )}

      {/* Agent Mail: the swarm's conversation, grouped by planner version. */}
      <AgentMailDrawer
        open={mailOpen}
        messages={messages}
        onClose={() => setMailOpen(false)}
      />

      {/* Workspace code: the real source the swarm wrote, step v1..vN. */}
      <CodeDrawer
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        activeTask={activeTask}
      />

      {/* Task inspector: opens on a bead click, anchored near the click point. */}
      <BeadInspector inspect={inspect} onClose={() => setInspect(null)} />
    </div>
    </ActiveTaskProvider>
  );
}
