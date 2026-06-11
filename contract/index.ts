// The single integration contract between the swarm and the cockpit.
// Both sides import from here (TS) or contract/events.py (Python).
import contract from "./glassbox.contract.json" with { type: "json" };

export const CONTRACT = contract;
export const PORTS = contract.ports;
export const REDIS = contract.redis;
export const EVENT_TYPES = contract.eventTypes;
export const AGENT_STATUS = contract.agentStatus;
export const AGENTS = contract.agents;
export const ARCHETYPE_IDS = contract.archetypes;

export type EventType = (typeof contract.eventTypes)[number];
export type AgentStatus = (typeof contract.agentStatus)[number];
/** Canonical loop-shape ids ("land", "climb", ...) shared by both sides. */
export type ArchetypeId = (typeof contract.archetypes)[number];

/** The canonical event envelope appended to the `glassbox:events` Redis stream. */
export interface GlassboxEvent {
  /** epoch milliseconds */
  ts: number;
  type: EventType;
  run_id: string;
  /**
   * The build target this event belongs to (e.g. "perf_takehome", "tokenizer").
   * The stream is global but leaderboards and the cockpit board are per-task, so
   * the board only applies events whose task matches its active task. Optional
   * for back-compat with pre-multi-task events (treated as the default task).
   */
  task?: string;
  planner_version: number;
  agent: string;
  bead_id?: string | null;
  title?: string;
  payload?: Record<string, unknown>;
  /**
   * The loop shape this run executes (one of ARCHETYPE_IDS), carried on
   * run_started so the board can draw the matching return edge and gauges.
   * Optional for back-compat with pre-archetype events.
   */
  archetype?: ArchetypeId | string | null;
}
