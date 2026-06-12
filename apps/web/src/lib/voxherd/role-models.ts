// Per-role model + effort for the REAL swarm spawn. Each spawned tmux session (planner,
// coordinator, workers, validator, improver) can run a different brain: the spawn sequence
// types "/model <id>" and "/effort <level>" into the fresh session BEFORE its role prompt,
// so the whole role runs on the chosen model. Choices persist in localStorage so the
// operator sets them once. The ids are Claude Code model aliases (what /model accepts).

export type RoleKey = "planner" | "coordinator" | "worker" | "validator" | "improver";

export interface RoleModelConfig {
  model: string; // a MODEL_CHOICES id, passed to /model
  effort: string; // an EFFORT_CHOICES level, passed to /effort
}

export type SwarmModels = Record<RoleKey, RoleModelConfig>;

export const MODEL_CHOICES = [
  { id: "fable", label: "Fable 5" },
  { id: "opus", label: "Opus 4.8" },
  { id: "sonnet", label: "Sonnet 4.6" },
  { id: "haiku", label: "Haiku 4.5" },
] as const;

export const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"] as const;

/** The rows the menu renders: one per role, workers collapsed to a single row for all N. */
export const ROLE_ROWS: { key: RoleKey; label: string; agent: string }[] = [
  { key: "planner", label: "planner", agent: "planner" },
  { key: "coordinator", label: "coordinator", agent: "coordinator" },
  { key: "worker", label: "workers", agent: "worker-1" },
  { key: "validator", label: "validator", agent: "validator" },
  { key: "improver", label: "improver", agent: "improver" },
];

// The operator's chosen defaults: deep reasoning (Fable, xhigh) where the swarm THINKS
// (plan, improve), grading rigor on the validator, and fast strong hands (Opus, max) for
// the implementing workers and the routing coordinator.
export const DEFAULT_SWARM_MODELS: SwarmModels = {
  planner: { model: "fable", effort: "xhigh" },
  coordinator: { model: "opus", effort: "max" },
  worker: { model: "opus", effort: "max" },
  validator: { model: "opus", effort: "xhigh" },
  improver: { model: "fable", effort: "xhigh" },
};

/** The localStorage key the swarm view persists the config under (via usePersistentState). */
export const SWARM_MODELS_KEY = "glassbox-swarm-models-v1";

/** Map a node name (worker-3, planner, ...) to its config row key. */
export function roleKeyOf(node: string): RoleKey | null {
  if (node.startsWith("worker-")) return "worker";
  if (node === "planner" || node === "coordinator" || node === "validator" || node === "improver")
    return node;
  return null;
}

export function modelLabel(id: string): string {
  return MODEL_CHOICES.find((m) => m.id === id)?.label ?? id;
}

/**
 * Revive a stored config: merge the saved roles over the defaults so new roles/fields
 * never come back blank and a corrupted entry falls back to its default.
 */
export function reviveSwarmModels(raw: unknown): SwarmModels {
  const saved = (raw ?? {}) as Partial<SwarmModels>;
  const merged = { ...DEFAULT_SWARM_MODELS } as SwarmModels;
  for (const key of Object.keys(merged) as RoleKey[]) {
    const s = saved[key];
    if (s && typeof s.model === "string" && typeof s.effort === "string")
      merged[key] = { model: s.model, effort: s.effort };
  }
  return merged;
}
