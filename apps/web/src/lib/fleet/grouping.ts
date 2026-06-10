// Group voxherd sessions by project, the way vibe-view groups tmux sessions.
// Ported and adapted from vibe-view's src/lib/agent-grouping.ts (fuzzy project
// merge via union-find), keyed on voxherd's clean `project` field.

import type { VoxSession } from "@/lib/voxherd/types";

export type SortMode = "recent" | "name" | "agents";

export interface FleetGroup {
  project: string;
  sessions: VoxSession[];
  isTeam: boolean; // more than one agent in the project
}

/** Strip a trailing -N or _N so "aligned-tools-3" and "aligned-tools" share a prefix. */
export function getProjectPrefix(name: string): string {
  return name.replace(/[-_]\d+$/, "");
}

const STATUS_RANK: Record<string, number> = { active: 0, waiting: 1, idle: 2 };

/**
 * Order sessions within a project so the active one reads leftmost-first:
 * active, then waiting, then idle, with the lower agent number breaking ties.
 */
function compareSessions(a: VoxSession, b: VoxSession): number {
  const ra = STATUS_RANK[a.status] ?? 3;
  const rb = STATUS_RANK[b.status] ?? 3;
  return ra - rb || (a.agent_number ?? 0) - (b.agent_number ?? 0);
}

/** Levenshtein edit distance (used to merge near-identical project names). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Group sessions by project, fuzzy-merging prefixes within edit distance 2. */
export function groupByProject(sessions: VoxSession[]): FleetGroup[] {
  const prefixes = sessions.map((s) => getProjectPrefix(s.project || s.session_id));

  // Union-find to merge similar prefixes.
  const parent = prefixes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < prefixes.length; i++) {
    for (let j = i + 1; j < prefixes.length; j++) {
      if (editDistance(prefixes[i], prefixes[j]) <= 2) {
        parent[find(i)] = find(j);
      }
    }
  }

  const groupMap = new Map<number, VoxSession[]>();
  const groupName = new Map<number, string>();
  for (let i = 0; i < sessions.length; i++) {
    const root = find(i);
    const list = groupMap.get(root) ?? [];
    list.push(sessions[i]);
    groupMap.set(root, list);
    // Canonical name = the shortest prefix in the group.
    if (!groupName.has(root) || prefixes[i].length < (groupName.get(root)?.length ?? Infinity)) {
      groupName.set(root, prefixes[i]);
    }
  }

  return Array.from(groupMap.entries()).map(([root, group]) => ({
    project: groupName.get(root) ?? group[0].project,
    sessions: [...group].sort(compareSessions),
    isTeam: group.length > 1,
  }));
}

/** Sort groups: recent activity, name, or most-agents-first. Teams float up on ties. */
export function sortGroups(groups: FleetGroup[], mode: SortMode): FleetGroup[] {
  const lastActivity = (g: FleetGroup): number =>
    Math.max(
      0,
      ...g.sessions.map((s) => (s.last_activity ? Date.parse(s.last_activity) || 0 : 0)),
    );
  const liveRank = (g: FleetGroup): number =>
    Math.min(...g.sessions.map((s) => STATUS_RANK[s.status] ?? 3));

  const sorted = [...groups];
  if (mode === "name") {
    sorted.sort((a, b) => a.project.localeCompare(b.project));
  } else if (mode === "agents") {
    sorted.sort((a, b) => b.sessions.length - a.sessions.length || a.project.localeCompare(b.project));
  } else {
    // recent: most recent activity first, with active groups floated up.
    sorted.sort((a, b) => liveRank(a) - liveRank(b) || lastActivity(b) - lastActivity(a));
  }
  return sorted;
}
