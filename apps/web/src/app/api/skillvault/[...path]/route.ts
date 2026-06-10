// Local proxy to the skillvault marketplace (https://skillvault.md). Keeps a single
// origin (no CORS) for the browser; the public API needs no auth. Catch-all path is
// forwarded verbatim, e.g. GET /api/skillvault/api/packages -> skillvault.md/api/packages.
export const runtime = "nodejs";
// No force-dynamic: it would force every upstream fetch to no-store and defeat the cache.
// The route reads req.url (so it stays per-request), but the upstream GET is cached for 60s
// (revalidate below), so the package catalog is not re-fetched on every keystroke search.

const SKILLVAULT = process.env.SKILLVAULT_URL || "https://skillvault.md";

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const search = new URL(req.url).search;
  const target = `${SKILLVAULT}/${(path ?? []).join("/")}${search}`;
  try {
    const upstream = await fetch(target, { next: { revalidate: 60 } });
    const text = await upstream.text();
    return new Response(text || "{}", {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: "skillvault_unreachable",
        target,
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
