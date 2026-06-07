import { REDIS } from "@glassbox/contract";
import { getRedis } from "@/lib/redis";
import { projectMail, type MailMessage } from "@/lib/cockpit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS_STREAM = REDIS.eventsStream;

// Bound how far back we reconstruct so a long-lived stream cannot return an
// unbounded payload. A whole climb is well under this.
const MAX_SCAN = 5000;

/**
 * GET /api/mail -> the full agent-to-agent message thread.
 *
 * Messages are `agent_message` events durably stored in the glassbox:events
 * stream (the same append-only log the live SSE tails). We XREVRANGE the recent
 * window, keep mail events, project them to the cockpit's MailMessage shape, and
 * return them in chronological order so the Agent Mail drawer can rehydrate the
 * entire climb on load or after a reload. Absent/garbled entries are skipped;
 * any failure yields [] so the drawer renders an empty inbox instead of erroring.
 */
export async function GET() {
  try {
    const redis = getRedis();
    // Newest-first; [ [id, [field, value, ...]], ... ].
    const entries = (await redis.xrevrange(
      EVENTS_STREAM,
      "+",
      "-",
      "COUNT",
      MAX_SCAN,
    )) as [string, string[]][];

    // If we hit the scan bound, the oldest mail beyond it is not returned. Log so
    // a long-lived session that truncates early history is observable, not silent.
    if (entries.length === MAX_SCAN) {
      console.warn(
        `[api/mail] scan hit MAX_SCAN=${MAX_SCAN}; older mail may be omitted`,
      );
    }

    const out: MailMessage[] = [];
    for (const [, fields] of entries) {
      let data: string | undefined;
      for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === "data") {
          data = fields[i + 1];
          break;
        }
      }
      if (!data) continue;

      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      // Shared projector with the live SSE path (toMail) so the two cannot drift.
      const mail = projectMail(ev);
      if (mail) out.push(mail);
    }

    // XREVRANGE gave newest-first; flip to chronological for the drawer.
    out.reverse();
    return Response.json(out);
  } catch {
    return Response.json([]);
  }
}
