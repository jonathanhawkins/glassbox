import { REDIS } from "@glassbox/contract";
import { createRedis } from "@/lib/redis";

// Long-lived streaming response: must run on the Node.js runtime (ioredis needs
// real TCP sockets) and must never be statically optimized or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hint to the platform/runtime that this can stream indefinitely.
export const maxDuration = 3600;

const EVENTS_STREAM = REDIS.eventsStream;

// How long XREAD blocks each loop before we wake to send a heartbeat / re-check
// the abort signal. Short enough to notice client disconnects promptly.
const BLOCK_MS = 15000;
const HEARTBEAT_MS = 15000;

const encoder = new TextEncoder();

/**
 * Server-Sent Events stream of the glassbox:events Redis stream.
 *
 * Tails new entries only (starts from "$") via a dedicated blocking ioredis
 * connection. Each stream entry has a single field `data` whose value is the
 * already-serialized JSON event envelope, so we forward it verbatim inside an
 * SSE `data:` frame. The cockpit board (Phase 3) consumes this with
 * `new EventSource("/api/events")` and JSON.parses each `event.data`.
 */
export async function GET(request: Request) {
  const redis = createRedis();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    // disconnect() tears down the socket immediately, interrupting any in-flight
    // blocking XREAD. quit() would wait for the block to finish.
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // Initial comment frame so the client's connection opens immediately and
      // any proxy flushes headers.
      send(": connected\n\n");

      // Periodic heartbeat comment to keep intermediaries from idling us out and
      // to detect a dead client (enqueue throws once the consumer is gone).
      heartbeat = setInterval(() => send(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS);

      // Abort when the client disconnects (browser closes EventSource / tab).
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      // Tail only events that arrive after we connect.
      let lastId = "$";

      try {
        while (!closed) {
          // BLOCK so we are push-driven; returns null on timeout (-> heartbeat
          // loop continues). Return type: [stream, [[id, [f, v, ...]], ...]][].
          const res = (await redis.xread(
            "BLOCK",
            BLOCK_MS,
            "STREAMS",
            EVENTS_STREAM,
            lastId,
          )) as [string, [string, string[]][]][] | null;

          if (closed) break;
          if (!res) continue; // timeout, loop and let heartbeat fire

          for (const [, entries] of res) {
            for (const [id, fields] of entries) {
              lastId = id;
              // fields is a flat [field, value, ...] list. Find "data".
              let data: string | undefined;
              for (let i = 0; i + 1 < fields.length; i += 2) {
                if (fields[i] === "data") {
                  data = fields[i + 1];
                  break;
                }
              }
              if (data === undefined) continue;
              // The value is already a JSON string; forward verbatim. Strip any
              // stray newlines so the SSE framing stays valid (the envelope is
              // single-line JSON, but be defensive).
              const oneLine = data.replace(/\r?\n/g, " ");
              send(`data: ${oneLine}\n\n`);
            }
          }
        }
      } catch {
        // redis error (e.g. server down or disconnect during shutdown): end the
        // stream cleanly so the client can reconnect.
      } finally {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so frames flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
