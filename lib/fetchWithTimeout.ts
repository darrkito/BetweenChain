import "server-only";

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Every external vendor call in this app (NFT: magiceden.ts/opensea.ts/
 * tradeport.ts; swap/chains: jupiter.ts/relay.ts/evm.ts/solana.ts/sui.ts)
 * funnels its upstream calls through this instead of the bare global
 * `fetch`. Originally built 2026-08-04 for the NFT vendor clients only
 * (moved out of lib/nft/ the same day, once it became clear the swap path
 * needed it too — see the API-hit-reduction/reliability pass in
 * swapperbetweenchains_project memory), the underlying bug class applies to
 * ANY server-side call to a third-party API, not just NFT vendors.
 *
 * Real bug found live 2026-08-04 (user report: browser console showed
 * "Failed to execute 'json' on 'Response': Unexpected end of JSON input").
 * None of the raw `fetch()` call sites across the NFT vendor files had a
 * timeout — if a vendor hung instead of failing fast (plausible during the
 * real Magic Eden rate-limit incident investigated the same day), our own
 * serverless function had nothing to catch inside its own try/catch.
 * Vercel's PLATFORM-level function-duration limit killed it first, which
 * returns an empty/non-JSON body — the client's `response.json()` then
 * choked on that empty body, producing exactly this error. This guarantees
 * OUR code fails first, well inside that limit, so the calling route's
 * existing try/catch always gets a chance to run and return a real,
 * parseable JSON error instead of nothing.
 *
 * 8s default: comfortably under even a conservative 10s platform limit,
 * while still generous for a real (non-hung) upstream call.
 */
export function fetchWithTimeout(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
}
