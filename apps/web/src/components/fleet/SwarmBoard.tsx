"use client";

// SwarmBoard: the existing cockpit node board (BoardController + the custom tldraw shapes)
// mounted standalone and fed by the swarm-adapter, so a REAL conductor session's tasks
// animate across the planner -> workers -> validator lanes. No board.ts changes; we only
// swap the event source to the live voxherd swarm adapter and reuse its camera framing
// (frameCamera fits the board into the viewport minus the floating-panel insets).

import { Tldraw, type Editor, type TLComponents } from "tldraw";
import "tldraw/tldraw.css";
import { useCallback, useEffect, useRef, useState } from "react";

import { BoardController } from "@/lib/cockpit/board";
import { AgentShapeUtil, BeadShapeUtil, DockShapeUtil } from "@/lib/cockpit/shapes";
import { SwarmRoutingEdges } from "@/components/fleet/SwarmRoutingEdges";
import { startSwarmAdapter } from "@/lib/voxherd/swarm-adapter";
import type { GlassboxEvent } from "@glassbox/contract";

const SHAPE_UTILS = [AgentShapeUtil, DockShapeUtil, BeadShapeUtil];

// Draw the planner -> coordinator -> workers -> validator -> improver flow arrows on the
// canvas (the same routing the original cockpit uses), and hide tldraw's default chrome.
const TL_COMPONENTS: TLComponents = {
  Background: () => null,
  Grid: () => null,
  OnTheCanvas: SwarmRoutingEdges,
};

export function SwarmBoard({
  sessionId,
  project,
  onReady,
  onEvent,
  workers = 4,
}: {
  sessionId: string;
  project: string;
  onReady?: (editor: Editor, controller: BoardController) => void;
  onEvent?: (ev: GlassboxEvent) => void;
  workers?: number;
}) {
  const controllerRef = useRef<BoardController | null>(null);
  // Latest-ref pattern: keep the newest onEvent/workers reachable from the
  // adapter callback below WITHOUT re-subscribing on every render. Assigned in
  // an effect (not the render body) so render stays pure.
  const onEventRef = useRef(onEvent);
  const workersRef = useRef(workers);
  useEffect(() => {
    onEventRef.current = onEvent;
    workersRef.current = workers;
  });
  const [ready, setReady] = useState(false);

  const handleMount = useCallback(
    (editor: Editor) => {
      const controller = new BoardController(editor);
      controller.setRealMode(true); // /swarm renders REAL session data, not the simulation
      controller.layout();
      controller.setActiveWorkers(workersRef.current);
      controller.frameCamera({ immediate: true });
      controllerRef.current = controller;
      onReady?.(editor, controller);
      // Re-fit shortly after, in case the container measured late on first paint.
      window.setTimeout(() => controller.frameCamera(), 400);
      setReady(true);
    },
    [onReady],
  );

  useEffect(() => {
    if (!ready || !controllerRef.current || !sessionId || !project) return;
    const controller = controllerRef.current;
    const stop = startSwarmAdapter({
      sessionId,
      project,
      workers: workersRef.current,
      onEvent: (ev) => {
        controller.apply(ev);
        onEventRef.current?.(ev);
      },
    });
    return stop;
  }, [ready, sessionId, project]);

  // Reflect the chosen worker count on the board (dim the inactive lanes) when it changes.
  useEffect(() => {
    controllerRef.current?.setActiveWorkers(workers);
  }, [workers, ready]);

  return (
    <div className="h-full w-full bg-canvas">
      <Tldraw
        shapeUtils={SHAPE_UTILS}
        components={TL_COMPONENTS}
        hideUi
        onMount={handleMount}
        autoFocus={false}
      />
    </div>
  );
}
