import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Redis-backed sliding-window rate limiter (Upstash), shared across
 * serverless instances/regions. Falls back to the old in-memory limiter when
 * UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN aren't set (local dev
 * without an Upstash database) — that fallback resets on redeploy and does
 * not share state across instances, so it must not be relied on in
 * production. A warning is logged once if production is running without it.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

if (!redis && process.env.NODE_ENV === "production") {
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — " +
      "falling back to in-memory rate limiting, which is NOT shared across " +
      "serverless instances. Set both env vars before real traffic.",
  );
}

// One Ratelimit instance per distinct (limit, windowMs) pair — cheap to
// create, but Upstash recommends reusing instances rather than constructing
// one per request.
const limiters = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  const existing = limiters.get(cacheKey);
  if (existing) return existing;

  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));
  const created = new Ratelimit({
    redis: redis!,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: false,
    prefix: "sbc:ratelimit",
  });
  limiters.set(cacheKey, created);
  return created;
}

// --- in-memory fallback (local dev only, see warning above) ---
const buckets = new Map<string, { count: number; resetAt: number }>();

function inMemoryRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { ok: true };
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfterMs?: number }> {
  if (!redis) {
    return inMemoryRateLimit(key, limit, windowMs);
  }

  const { success, reset } = await getLimiter(limit, windowMs).limit(key);
  return success ? { ok: true } : { ok: false, retryAfterMs: Math.max(0, reset - Date.now()) };
}

export function clientKey(req: Request, suffix: string): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${ip}:${suffix}`;
}
