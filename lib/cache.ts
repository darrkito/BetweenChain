import "server-only";

/**
 * Tiny in-memory TTL cache. Single-instance only — same known limitation as
 * lib/rate-limit.ts (resets on redeploy, not shared across serverless
 * instances). Fine for local/single-region; revisit alongside rate-limit if
 * this ever runs multi-instance.
 */
const store = new Map<string, { data: unknown; expiresAt: number }>();

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data as T;
  }
  const data = await fetcher();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}
