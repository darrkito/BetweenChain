import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Single shared Upstash Redis client, used by both lib/rate-limit.ts and
 * lib/cache.ts. `null` when UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN
 * aren't set (local dev without a linked Upstash database) — every caller
 * must handle that by falling back to its own single-instance in-memory
 * behavior, same pattern rate-limit.ts already used before this was
 * extracted out of it.
 */
export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Keyed by callerLabel so rate-limit.ts and cache.ts each get their own
// one-time warning — a single shared boolean would let whichever module
// initializes first silently suppress the other's warning.
const warnedCallers = new Set<string>();

/** Logs the "no Redis in production" warning at most once per (instance, callerLabel). */
export function warnIfMissingRedisInProduction(callerLabel: string): void {
  if (redis || warnedCallers.has(callerLabel) || process.env.NODE_ENV !== "production") return;
  warnedCallers.add(callerLabel);
  console.warn(
    `[${callerLabel}] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — ` +
      "falling back to in-memory state, which is NOT shared across serverless " +
      "instances and resets on every redeploy. Set both env vars before real traffic.",
  );
}
