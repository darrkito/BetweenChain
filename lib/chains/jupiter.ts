import "server-only";
import { JUPITER_FEE_ACCOUNT, JUPITER_FEE_BPS } from "@/lib/fees";
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
export async function searchJupiterTokens(term: string, limit = 30): Promise<TokenListItem[]> {
  const res = await fetch(`${JUPITER_TOKENS_API}/search?query=${encodeURIComponent(term)}`, {
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
 * Quotes sourceMint -> SOL. Amount is in the source token's smallest unit.
 * This is leg 1 of a cross-chain swap: convert whatever meme coin the user
 * holds into native SOL, which Relay then bridges onward.
 */
export async function getJupiterQuote(params: {
  sourceMint: string;
  amount: string;
  slippageBps: number;
}): Promise<JupiterQuote> {
  const { sourceMint, amount, slippageBps } = params;

  if (sourceMint === NATIVE_SOL_MINT) {
    throw new Error("Source is already native SOL — no Jupiter leg needed");
  }

  const url = new URL(`${JUPITER_API}/quote`);
  url.searchParams.set("inputMint", sourceMint);
  url.searchParams.set("outputMint", NATIVE_SOL_MINT);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", String(slippageBps));
  // No fee charged on this leg until JUPITER_FEE_ACCOUNT is set (requires a
  // one-time wrapped-SOL token account created via referral.jup.ag — see
  // lib/fees.ts). Quote and swap must agree on this or Jupiter rejects the
  // swap for not matching the quoted route.
  if (JUPITER_FEE_ACCOUNT) {
    url.searchParams.set("platformFeeBps", String(JUPITER_FEE_BPS));
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Jupiter quote failed (${res.status}): ${await res.text()}`);
  }
  const route = await res.json();

  return {
    inputMint: sourceMint,
    outputMint: NATIVE_SOL_MINT,
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
  const res = await fetch(`${JUPITER_API}/swap`, {
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
