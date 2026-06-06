import Redis, { type RedisOptions } from "ioredis";

/**
 * Redis connection helpers for the Glassbox cockpit transport seam.
 *
 * Two access patterns:
 *  - `getRedis()` returns a shared, lazily-created client for quick non-blocking
 *    reads (leaderboard zset, beads key). Reused across requests in the Node.js
 *    runtime so we do not open a socket per request.
 *  - `createRedis()` returns a brand-new dedicated client. Use this for blocking
 *    commands (XREAD BLOCK) because ioredis serializes commands on one socket, so
 *    a long block would stall every other consumer of the shared client. The SSE
 *    route owns its connection and quits it on cancel.
 */

export const REDIS_URL =
  process.env.REDIS_URL || "redis://127.0.0.1:6379";

const BASE_OPTIONS: RedisOptions = {
  // Keep failures fast and observable instead of buffering commands forever when
  // redis is down. Routes translate errors into clean JSON / SSE close.
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  retryStrategy(times) {
    // Cap backoff so a downed redis does not wedge a hot reload loop.
    return Math.min(times * 200, 2000);
  },
};

// Persist the shared client across hot reloads in dev (module re-evaluation)
// using a global so we do not leak connections.
const globalForRedis = globalThis as unknown as {
  __glassboxRedis?: Redis;
};

/** Shared client for non-blocking reads. Created lazily, reused thereafter. */
export function getRedis(): Redis {
  if (!globalForRedis.__glassboxRedis) {
    const client = new Redis(REDIS_URL, BASE_OPTIONS);
    // Avoid unhandled 'error' events crashing the process when redis is down;
    // individual commands still reject and routes handle that.
    client.on("error", () => {});
    globalForRedis.__glassboxRedis = client;
  }
  return globalForRedis.__glassboxRedis;
}

/**
 * Dedicated client for blocking commands (XREAD BLOCK). The caller MUST quit it
 * when done (e.g. on stream cancel) to free the socket.
 */
export function createRedis(): Redis {
  const client = new Redis(REDIS_URL, BASE_OPTIONS);
  client.on("error", () => {});
  return client;
}
