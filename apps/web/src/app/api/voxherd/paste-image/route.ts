// Saves a pasted clipboard image to a local temp file so a worker (Claude Code running
// in tmux) can read it by absolute path. The cockpit drives sessions over `tmux
// send-keys` (text only), so we cannot ship bytes into the pane; instead we persist the
// image here and send the worker its path, mirroring Claude Code's own [Image #N] paste.
//
// A static segment, so it takes precedence over the [...path] proxy and is NOT forwarded
// to the bridge. Runs locally (the dev server is on the user's machine).
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function POST(req: Request): Promise<Response> {
  let body: { dataUrl?: string };
  try {
    body = (await req.json()) as { dataUrl?: string };
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(body.dataUrl ?? "");
  if (!m) {
    return Response.json({ ok: false, error: "not_a_base64_image" }, { status: 400 });
  }
  const ext = EXT[m[1].toLowerCase()] ?? "png";
  const dir = join(tmpdir(), "voxherd-pasted");
  try {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `paste-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`);
    await writeFile(path, Buffer.from(m[2], "base64"));
    return Response.json({ ok: true, path });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
