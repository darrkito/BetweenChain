import "server-only";
import { JUPITER_FEE_ACCOUNT, JUPITER_FEE_BPS } from "@/lib/fees";
import { cached } from "@/lib/cache";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import type { TokenListItem } from "@/lib/chains/types";

const JUPITER_API = process.env.JUPITER_QUOTE_API ?? "https://lite-api.jup.ag/swap/v1";
const JUPITER_TOKENS_API = "https://lite-api.jup.ag/tokens/v2";
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const SOLANA_CHAIN_ID = 792703809;

interface JupiterTokenSearchResult {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  organicScoreLabel?: string;
}

/**
 * Token search for the Solana Sell-side picker. Deliberately NOT the same
 * search used for other chains (see lib/chains/relay.ts's
 * searchRelayCurrencies): Jupiter, not Relay, is the execution authority for
 * this leg, and Relay's currency index is scoped to what it can bridge, not
 * the full universe of Solana SPL tokens. A real, liquid, Jupiter-tradeable
 * token (e.g. a graduated pump.fun launch) can be completely absent from
 * Relay's index — confirmed live during a real search miss — while still
 * being perfectly swappable via this leg. Same principle already applied to
 * Solana trending in lib/chains/trending.ts; search just hadn't gotten it.
 */
// 2026-08-04 (API-hit reduction pass) — this was completely uncached, hit
// fresh on every debounced keystroke. Popular terms ("sol", "usdc", "eth")
// are searched identically by many users; 30s TTL absorbs that without
// meaningfully staling out results (token search results — name/symbol/
// decimals — don't change minute to minute the way a price would).
const SEARCH_TTL_MS = 30_000;

export async function searchJupiterTokens(term: string, limit = 30): Promise<TokenListItem[]> {
  return cached(`jupiter:search:${term}:${limit}`, SEARCH_TTL_MS, async () => {
    const res = await fetchWithTimeout(`${JUPITER_TOKENS_API}/search?query=${encodeURIComponent(term)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Jupiter token search failed (${res.status})`);
    const tokens = (await res.json()) as JupiterTokenSearchResult[];

    return tokens.slice(0, limit).map((t) => ({
      chainId: SOLANA_CHAIN_ID,
      address: t.id,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoURI: t.icon ?? "",
      verified: t.organicScoreLabel === "high",
      isNative: t.id === NATIVE_SOL_MINT,
      source: "search",
    }));
  });
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  route: unknown; // raw Jupiter quote response, replayed verbatim into /swap
}

/**
 * Quotes sourceMint -> destinationMint (defaults to native SOL). Amount is
 * in the source token's smallest unit.
 *
 * Two real callers of this, both real Jupiter quotes, same function:
 * 1. Leg 1 of a cross-chain swap — convert whatever SPL token the user holds
 *    into native SOL (destinationMint left at its default), which Relay
 *    then bridges onward. destinationMint is never anything else here.
 * 2. A same-chain Solana SPL<->SPL (or SOL<->SPL) swap (2026-08-07, real
 *    gap found live — this app's Buy-side token picker previously only
 *    ever allowed picking native SOL as a same-chain Solana destination,
 *    even though Jupiter's own aggregator has always supported any
 *    mint-to-mint pair) — destinationMint is the buyer's actual pick.
 */
export async function getJupiterQuote(params: {
  sourceMint: string;
  destinationMint?: string;
  amount: string;
  slippageBps: number;
}): Promise<JupiterQuote> {
  const { sourceMint, amount, slippageBps } = params;
  const destinationMint = params.destinationMint ?? NATIVE_SOL_MINT;

  if (sourceMint === destinationMint) {
    throw new Error("Source and destination are the same token — no Jupiter quote needed");
  }

  const url = new URL(`${JUPITER_API}/quote`);
  url.searchParams.set("inputMint", sourceMint);
  url.searchParams.set("outputMint", destinationMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", String(slippageBps));
  // No fee charged on this leg until JUPITER_FEE_ACCOUNT is set (requires a
  // one-time wrapped-SOL token account created via referral.jup.ag — see
  // lib/fees.ts). Quote and swap must agree on this or Jupiter rejects the
  // swap for not matching the quoted route.
  if (JUPITER_FEE_ACCOUNT) {
    url.searchParams.set("platformFeeBps", String(JUPITER_FEE_BPS));
  }

  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Jupiter quote failed (${res.status}): ${await res.text()}`);
  }
  const route = await res.json();

  return {
    inputMint: sourceMint,
    outputMint: destinationMint,
    inAmount: route.inAmount,
    outAmount: route.outAmount,
    otherAmountThreshold: route.otherAmountThreshold,
    slippageBps,
    priceImpactPct: route.priceImpactPct,
    route,
  };
}

/**
 * Builds the unsigned swap transaction for a previously-fetched quote. The
 * route object must be the exact one returned by getJupiterQuote — Jupiter
 * requires the raw quote response to be replayed, not reconstructed, so this
 * is always called with the cached `jupiter_route` from swap_quotes, never a
 * fresh quote (which would defeat the address/amount binding).
 */
export async function buildJupiterSwapTransaction(params: {
  route: unknown;
  userPublicKey: string;
}): Promise<{ swapTransaction: string }> {
  const res = await fetchWithTimeout(`${JUPITER_API}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.route,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
      ...(JUPITER_FEE_ACCOUNT ? { feeAccount: JUPITER_FEE_ACCOUNT } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Jupiter swap build failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
