// Browser-side skillvault client (through the Next proxy /api/skillvault/*).
// A "package" is a bundle of Claude Code SKILL.md files; skill_names lists them.

export interface SkillPackage {
  id: string; // "author/name"
  name: string;
  display_name?: string;
  tagline?: string;
  category?: string;
  author_id?: string;
  skill_names: string[];
}

function asNames(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Search/list skill packages (GET /api/packages). */
export async function listPackages(q = ""): Promise<SkillPackage[]> {
  const url = `/api/skillvault/api/packages?limit=100&sort=downloads${
    q ? `&q=${encodeURIComponent(q)}` : ""
  }`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`skillvault ${res.status}`);
  const data = (await res.json()) as { packages?: Record<string, unknown>[] };
  return (data.packages ?? []).map((p) => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    display_name: p.display_name ? String(p.display_name) : undefined,
    tagline: p.tagline ? String(p.tagline) : undefined,
    category: p.category ? String(p.category) : undefined,
    author_id: p.author_id ? String(p.author_id) : undefined,
    skill_names: asNames(p.skill_names),
  }));
}
