/**
 * Backend proxy helper.
 *
 * The Python swarm (FastAPI/AG-UI) runs at NEXT_PUBLIC_BACKEND_URL (default
 * http://127.0.0.1:8100). The cockpit triggers runs/loops through Next route
 * handlers so the browser never talks to the backend directly (single origin,
 * no CORS, and we can fail gracefully when the backend is down).
 */

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8100";

/**
 * Forward a JSON POST body to `path` on the backend and relay its JSON response.
 * Returns a clean 502 JSON when the backend is unreachable or replies with a
 * non-JSON / error body, so callers always get parseable JSON.
 */
export async function proxyPost(path: string, req: Request): Promise<Response> {
  // Read the incoming body defensively; default to {} if empty/invalid.
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const target = `${BACKEND_URL}${path}`;

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Avoid any caching of mutation calls.
      cache: "no-store",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: "backend_unreachable",
        detail: `could not reach backend at ${target}`,
        target,
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // Relay the backend response. Prefer JSON; if the backend returned non-JSON,
  // wrap it so the client still receives parseable JSON.
  const text = await upstream.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return Response.json(
      {
        ok: false,
        error: "backend_bad_response",
        status: upstream.status,
        body: text.slice(0, 2000),
      },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }

  return Response.json(payload, { status: upstream.status });
}

/**
 * Forward a GET to `path` on the backend and relay its JSON response. Returns a
 * clean 502 JSON when the backend is unreachable or replies with a non-JSON
 * body, so callers always get parseable JSON.
 */
export async function proxyGet(path: string): Promise<Response> {
  const target = `${BACKEND_URL}${path}`;
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(target, { method: "GET", cache: "no-store" });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: "backend_unreachable",
        detail: `could not reach backend at ${target}`,
        target,
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return Response.json(
      {
        ok: false,
        error: "backend_bad_response",
        status: upstream.status,
        body: text.slice(0, 2000),
      },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }

  return Response.json(payload, { status: upstream.status });
}
