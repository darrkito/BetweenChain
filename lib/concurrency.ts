/**
 * Maps over `items` with at most `concurrency` in flight at once, instead of
 * firing every call simultaneously via a bare `Promise.all`. Built 2026-08-04
 * (API-hit-reduction pass) for lib/nft/opensea.ts's per-collection /stats
 * fan-out (browseOpenSeaCollections) and per-listing metadata fan-out
 * (getOpenSeaListings) — both used to fire up to ~40/20 simultaneous
 * requests on a single cache-miss page load, which can nearly exhaust
 * OpenSea's 60-reads/min budget in one burst. Spreading the same total call
 * count over time (not reducing it) meaningfully cuts 429 risk from the
 * burst shape itself, without losing any of the data those calls fetch.
 */
export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
