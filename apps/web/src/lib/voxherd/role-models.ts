// Per-role model + effort for the REAL swarm spawn. Each spawned tmux session (planner,
// coordinator, workers, validator, improver) can run a different brain, and a brain can now be
// either Claude Code OR OpenAI Codex:
//   - Claude roles: the spawn types "/model <id>" and "/effort <level>" into the fresh session
//     BEFORE its role prompt (those are non-interactive slash commands that apply on Enter).
//   - Codex roles: Codex's TUI "/model" is an INTERACTIVE picker (no inline args, verified against
//     the codex source) and send-keys can't drive a popup, so a Codex role is configured at LAUNCH
//     instead — the bridge starts `codex -m <id> -c model_reasoning_effort=<level>` (see swarm-spawn).
// Choices persist in localStorage so the operator sets them once.

export type RoleKey = "planner" | "coordinator" | "worker" | "validator" | "improver";

/** Which CLI a brain runs in. Drives how the spawn applies model + effort (see header). */
export type Assistant = "claude" | "codex";

export interface RoleModelConfig {
  model: string; // a MODEL_CHOICES id; the assistant is derived from it via assistantOf()
  effort: string; // an effort level VALID for that model's assistant (see effortsFor)
}

export type SwarmModels = Record<RoleKey, RoleModelConfig>;

export interface ModelChoice {
  id: string; // Claude: a /model alias. Codex: an OpenAI model id passed as `codex -m <id>`.
  label: string;
  assistant: Assistant;
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  // Claude Code aliases (set in-session via /model).
  { id: "fable", label: "Fable 5", assistant: "claude" },
  { id: "opus", label: "Opus 4.8", assistant: "claude" },
  { id: "sonnet", label: "Sonnet 4.6", assistant: "claude" },
  { id: "haiku", label: "Haiku 4.5", assistant: "claude" },
  // OpenAI Codex CLI model ids (set at launch via `codex -m <id>`). gpt-5.5 is OpenAI's current
  // recommended default for Codex; 5.4 is the flagship; 5.4-mini is the fast subagent tier.
  { id: "gpt-5.5", label: "GPT-5.5", assistant: "codex" },
  { id: "gpt-5.4", label: "GPT-5.4", assistant: "codex" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", assistant: "codex" },
] as const;

// Effort levels DIFFER by brain. Claude Code goes low..max; Codex's model_reasoning_effort goes
// minimal..xhigh with NO "max" (the exact enum, verified against codex-cli 0.137:
// none|minimal|low|medium|high|xhigh — "none" is omitted here as it disables reasoning, which a
// swarm role never wants). The menu offers only the valid set per brain and clamps when a role's
// brain changes, so a Codex role never carries Claude's "max" and a Claude role never carries
// Codex's "minimal".
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const CODEX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
/** Back-compat alias for importers that predate the per-brain split (the Claude set). */
export const EFFORT_CHOICES = CLAUDE_EFFORTS;

/** The rows the menu renders: one per role, workers collapsed to a single row for all N. */
export const ROLE_ROWS: { key: RoleKey; label: string; agent: string }[] = [
  { key: "planner", label: "planner", agent: "planner" },
  { key: "coordinator", label: "coordinator", agent: "coordinator" },
  { key: "worker", label: "workers", agent: "worker-1" },
  { key: "validator", label: "validator", agent: "validator" },
  { key: "improver", label: "improver", agent: "improver" },
];

// The operator's chosen defaults: deep reasoning (Opus, xhigh) where the swarm THINKS
// (plan, improve), grading rigor on the validator, and fast strong hands (Opus, max) for
// the implementing workers and the routing coordinator. All-Claude by default; the operator
// opts a role into Codex per run via the menu.
export const DEFAULT_SWARM_MODELS: SwarmModels = {
  planner: { model: "opus", effort: "xhigh" },
  coordinator: { model: "opus", effort: "max" },
  worker: { model: "opus", effort: "max" },
  validator: { model: "opus", effort: "xhigh" },
  improver: { model: "opus", effort: "xhigh" },
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

/** Which CLI a model id runs in. Unknown ids default to Claude (the historical brain). */
export function assistantOf(modelId: string): Assistant {
  return MODEL_CHOICES.find((m) => m.id === modelId)?.assistant ?? "claude";
}

/** The effort levels a given brain actually accepts. */
export function effortsFor(assistant: Assistant): readonly string[] {
  return assistant === "codex" ? CODEX_EFFORTS : CLAUDE_EFFORTS;
}

/**
 * Clamp an effort to one the assistant accepts, mapping across brains by intent: Claude's top
 * "max" -> Codex's top "xhigh", Codex's floor "minimal" -> Claude's floor "low". An
 * already-valid value passes through; anything unknown lands on a safe "high".
 */
export function coerceEffort(assistant: Assistant, effort: string): string {
  if (effortsFor(assistant).includes(effort)) return effort;
  if (assistant === "codex" && effort === "max") return "xhigh";
  if (assistant === "claude" && effort === "minimal") return "low";
  return "high";
}

/**
 * Revive a stored config: merge the saved roles over the defaults so new roles/fields never come
 * back blank and a corrupted entry falls back to its default. Each surviving entry's effort is
 * coerced to the model's brain, so a persisted (or hand-edited) Codex+"max" comes back as a valid
 * Codex effort instead of a level Codex would reject.
 */
export function reviveSwarmModels(raw: unknown): SwarmModels {
  const saved = (raw ?? {}) as Partial<SwarmModels>;
  const merged = { ...DEFAULT_SWARM_MODELS } as SwarmModels;
  for (const key of Object.keys(merged) as RoleKey[]) {
    const s = saved[key];
    if (s && typeof s.model === "string" && typeof s.effort === "string")
      merged[key] = { model: s.model, effort: coerceEffort(assistantOf(s.model), s.effort) };
  }
  return merged;
}
