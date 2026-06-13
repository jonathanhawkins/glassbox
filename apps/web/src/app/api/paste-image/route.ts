// Save an image pasted into a cockpit input (the header goal field or the conductor console) to
// a stable file on disk and return its absolute path. The swarm's sessions run on this host and
// the path gets typed into them, where Claude Code Reads it: tmux send-keys carries text, never
// binary, so a pasted screenshot only reaches the conductor/workers as a file path.
export const runtime = "nodejs";

import { writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Clipboard image MIME -> file extension. Unknown image types fall back to .png.
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
};

const MAX_BYTES = 25 * 1024 * 1024; // refuse a runaway clipboard blob

export async function POST(req: Request): Promise<Response> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) {
    return Response.json({ ok: false, error: "content-type must be image/*" }, { status: 415 });
  }
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) return Response.json({ ok: false, error: "empty body" }, { status: 400 });
    if (buf.length > MAX_BYTES) {
      return Response.json({ ok: false, error: "image too large" }, { status: 413 });
    }
    const dir = join(homedir(), ".glassbox", "pasted");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}.${EXT[type] ?? "png"}`);
    await writeFile(path, buf);
    return Response.json({ ok: true, path, bytes: buf.length });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
