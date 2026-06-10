// Real skill install: download a skillvault package and unzip its SKILL.md into the target
// project's .claude/skills/<name>/ so the swarm's sessions actually DISCOVER and run it.
// This replaces "message the conductor and hope it installs" with a guaranteed install.
export const runtime = "nodejs";

import { execFile } from "node:child_process";
import { writeFile, mkdir, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);
const SKILLVAULT = process.env.SKILLVAULT_URL || "https://skillvault.md";

export async function POST(req: Request): Promise<Response> {
  let body: { id?: string; dir?: string };
  try {
    body = (await req.json()) as { id?: string; dir?: string };
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const dir = String(body.dir ?? "");
  // Sanitize the skill folder name to the last path segment of the id.
  const name = (id.split("/").pop() ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id || !name) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  if (!dir.startsWith("/")) return Response.json({ ok: false, error: "dir must be absolute" }, { status: 400 });
  try {
    // The target project dir must already exist (we never create arbitrary trees).
    const ds = await stat(dir).catch(() => null);
    if (!ds?.isDirectory()) return Response.json({ ok: false, error: "dir not found" }, { status: 400 });

    const r = await fetch(`${SKILLVAULT}/api/packages/${id}/download`, { cache: "no-store" });
    if (!r.ok) return Response.json({ ok: false, error: `download ${r.status}` }, { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    const tmpZip = join(tmpdir(), `skill-${name}-${buf.length}.zip`);
    await writeFile(tmpZip, buf);

    const target = join(dir, ".claude", "skills", name);
    await mkdir(target, { recursive: true });
    // -j flattens paths (no zip-slip); -o overwrites. execFile (no shell) avoids injection.
    await execFileP("unzip", ["-o", "-j", tmpZip, "-d", target]);
    await rm(tmpZip, { force: true });

    const skill = join(target, "SKILL.md");
    const ok = await stat(skill).then((s) => s.isFile()).catch(() => false);
    return Response.json({ ok, path: ok ? skill : target, name });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
