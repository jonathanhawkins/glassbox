// Download the exported marketing mp4 (404 until a render has completed).

import fs from "node:fs";
import { Readable } from "node:stream";

import { renderedFile } from "@/lib/marketing-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const file = renderedFile();
  if (!file) {
    return Response.json({ error: "no export yet, render first" }, { status: 404 });
  }
  const stat = fs.statSync(file);
  const stream = Readable.toWeb(fs.createReadStream(file));
  return new Response(stream as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": 'attachment; filename="glassbox-marketing.mp4"',
      "Cache-Control": "no-store",
    },
  });
}
