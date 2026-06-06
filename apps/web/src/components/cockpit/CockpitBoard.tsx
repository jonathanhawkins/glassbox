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
import type { SkillState } from "@/lib/cockpit/types";

import { BoardController } from "@/lib/cockpit/board";
import { RoutingEdges } from "@/lib/cockpit/RoutingEdges";
import { AgentShapeUtil, BeadShapeUtil } from "@/lib/cockpit/shapes";

import { CorrectnessCurve } from "./CorrectnessCurve";
import { EventsTicker } from "./EventsTicker";
import { LaunchControls } from "./LaunchControls";
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

// Custom shape utils, defined once outside render (tldraw requires a stable ref).
const SHAPE_UTILS = [AgentShapeUtil, BeadShapeUtil];

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
  const [goal, setGoal] = useState<string>("port the BPE tokenizer to Rust");
  const [version, setVersion] = useState<number>(1);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [events, setEvents] = useState<GlassboxEvent[]>([]);
  const [sseOpen, setSseOpen] = useState(false);
  const [skill, setSkill] = useState<SkillState | null>(null);

  const handleMount = useCallback((editor: Editor) => {
    const controller = new BoardController(editor);
    controller.onGoal = (g) => setGoal(g);
    controller.onPlannerVersion = (v) => setVersion(v);
    controller.onFinished = (a) => setAccuracy(a);
    controller.onSkill = (s) => setSkill(s);
    controller.layout();
    controllerRef.current = controller;

    // Hydrate the existing board + curve so a reload mid-run is not blank.
    void (async () => {
      try {
        const res = await fetch("/api/beads", { cache: "no-store" });
        const snapshot = await res.json();
        controller.hydrateBeads(snapshot);
      } catch {
        // empty board is fine
      }
      let lastVersion = 1;
      let lastAccuracy: number | null = null;
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const rows = (await res.json()) as { version: number; accuracy: number }[];
        if (Array.isArray(rows) && rows.length) {
          const last = rows[rows.length - 1];
          lastVersion = last.version;
          lastAccuracy = last.accuracy;
          setVersion(last.version);
          setAccuracy(last.accuracy);
        }
      } catch {
        // no curve yet is fine
      }
      try {
        const res = await fetch("/api/skill", { cache: "no-store" });
        const data = (await res.json()) as { covered?: string[] };
        const covered = Array.isArray(data?.covered) ? data.covered : [];
        controller.hydrateSkill(covered, lastVersion, lastAccuracy);
      } catch {
        // no skill snapshot yet is fine
      }
    })();

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

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

  return (
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

      {/* Left controls + legend dock. */}
      <div className="pointer-events-none absolute bottom-5 left-5 z-20 flex w-[280px] flex-col gap-3">
        <div className="pointer-events-auto rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <LaunchControls />
        </div>
        <div className="pointer-events-auto rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <Legend />
        </div>
      </div>

      {/* Right rail: curve on top, the CopilotKit command bar filling the rail,
          and a compact live event strip at the bottom. */}
      <aside className="pointer-events-none absolute bottom-5 right-5 top-28 z-20 flex w-[380px] flex-col gap-3">
        <div className="pointer-events-auto h-[210px] shrink-0 rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <CorrectnessCurve />
        </div>
        {/* CopilotKit command bar (generative UI chat). Drives runs by chat and
            renders the curve / leaderboard inline. */}
        <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cyan-500/25 bg-slate-950/70 backdrop-blur">
          <div className="flex items-center justify-between border-b border-slate-800/70 px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-300/90">
              copilot
            </span>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] text-cyan-300/90">
              live
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CockpitCopilot />
          </div>
        </div>
        {/* Compact live event strip. */}
        <div className="pointer-events-auto h-[150px] shrink-0 overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-950/70 p-3 backdrop-blur">
          <EventsTicker events={events} />
        </div>
      </aside>

      {/* Planner skill evolution strip: the self-improvement made visible. */}
      {skill && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 w-[min(560px,44vw)] -translate-x-1/2">
          <PlannerSkillPanel skill={skill} />
        </div>
      )}
    </div>
  );
}
