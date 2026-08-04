import "server-only";

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Every NFT vendor client (magiceden.ts/opensea.ts/tradeport.ts) funnels its
 * upstream calls through this instead of the bare global `fetch`.
 *
 * Real bug found live 2026-08-04 (user report: browser console showed
 * "Failed to execute 'json' on 'Response': Unexpected end of JSON input").
 * None of the (12, across the three vendor files) raw `fetch()` call sites
 * had a timeout — if a vendor hung instead of failing fast (plausible during
 * the real Magic Eden rate-limit incident investigated the same day), our
 * own serverless function had nothing to catch inside its own try/catch.
 * Vercel's PLATFORM-level function-duration limit killed it first, which
 * returns an empty/non-JSON body — the client's `response.json()` then
 * choked on that empty body, producing exactly this error. This guarantees
 * OUR code fails first, well inside that limit, so the calling route's
 * existing try/catch (see app/api/nft/collection/route.ts,
 * app/api/nft/listings/route.ts) always gets a chance to run and return a
 * real, parseable JSON error instead of nothing.
 *
 * 8s default: comfortably under even a conservative 10s platform limit,
 * while still generous for a real (non-hung) upstream call.
 */
export function fetchWithTimeout(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
}
