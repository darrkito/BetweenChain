import "server-only";
import { redis, warnIfMissingRedisInProduction } from "@/lib/redis";

/**
 * Redis-backed TTL cache (Upstash), shared across serverless instances/
 * regions — same upgrade lib/rate-limit.ts already got. Falls back to the
 * old single-instance in-memory Map when UPSTASH_REDIS_REST_URL/
 * UPSTASH_REDIS_REST_TOKEN aren't set (local dev without a linked Upstash
 * database).
 *
 * Why this mattered enough to build (2026-08-04): every caller below
 * (magiceden.ts/opensea.ts/tradeport.ts's collection-fetching, plus
 * heliusDas.ts/trending.ts/relayChains.ts/the quote-preview route) already
 * used the in-memory version, but that cache is per-instance — concurrent
 * requests landing on different Vercel serverless instances (likely under
 * real traffic, or across regions) each got their own empty cache, so the
 * TTL only ever protected repeat hits on the SAME instance. That mattered
 * most for OpenSea's thin 60-reads/min agent-tier key and Magic Eden's
 * documented rate-limit fragility (see PLAN.md/STATE.md's NFT vendor
 * history). Redis makes a cache warmed by one request actually protect
 * every other concurrent request, and survive redeploys instead of
 * resetting on every one (this app redeploys often).
 *
 * Redis errors (network blip, Upstash outage) are treated as a cache miss,
 * never a thrown error — caching must never be a hard dependency that takes
 * the whole request down. Upstash's `get`/`set` auto JSON-serialize/
 * deserialize non-string values by default (confirmed against the SDK's
 * actual source, not assumed), so this keeps the exact same `cached<T>()`
 * signature the in-memory version had — every existing call site needed
 * zero changes.
 */
const REDIS_KEY_PREFIX = "bc:cache:";

// --- in-memory fallback (local dev only, see warnIfMissingRedisInProduction) ---
const store = new Map<string, { data: unknown; expiresAt: number }>();

function inMemoryCached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return Promise.resolve(hit.data as T);
  }
  return fetcher().then((data) => {
    store.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  });
}

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  warnIfMissingRedisInProduction("cache");
  if (!redis) {
    return inMemoryCached(key, ttlMs, fetcher);
  }

  const redisKey = REDIS_KEY_PREFIX + key;

  try {
    const hit = await redis.get<T>(redisKey);
    if (hit !== null && hit !== undefined) {
      return hit;
    }
  } catch (e) {
    console.warn(`[cache] Redis GET failed for "${key}", treating as a miss:`, e);
  }

  const data = await fetcher();

  try {
    const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));
    await redis.set(redisKey, data, { ex: ttlSeconds });
  } catch (e) {
    console.warn(`[cache] Redis SET failed for "${key}", value was still returned but not cached:`, e);
  }

  return data;
}
