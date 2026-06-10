// Shapes returned by the voxherd-bridge REST API (see voxherd/docs/api.md).

export type SessionStatus = "active" | "idle" | "waiting";

/** One registered assistant session, from GET /api/sessions. */
export interface VoxSession {
  session_id: string;
  assistant: string; // "claude" | "codex" | "gemini"
  project: string;
  project_dir: string;
  status: SessionStatus;
  /** Human name (e.g. a swarm role) set via renameSession; shown in the UI when present. */
  window_name?: string;
  last_summary?: string;
  registered_at?: string;
  last_activity?: string;
  tmux_target?: string;
  activity_snippet?: string;
  terminal_preview?: string;
  activity_type?: string; // thinking | writing | running | testing | building
  stop_reason?: string;
  agent_number?: number;
  sub_agent_count?: number;
  sub_agent_tasks?: unknown[];
}

export interface CommandResult {
  ok?: boolean;
  error?: string;
}
