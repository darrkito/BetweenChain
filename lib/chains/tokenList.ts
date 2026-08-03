import "server-only";
import { getRelayChain } from "@/lib/chains/relayChains";
import { getTrendingForChain } from "@/lib/chains/trending";
import { searchRelayCurrencies, filterRoutableCurrencies, SOLANA_CHAIN_ID } from "@/lib/chains/relay";
import { searchJupiterTokens } from "@/lib/chains/jupiter";
import type { TokenListItem } from "@/lib/chains/types";

/**
 * Ordered token list for a chain: [native gas token, USDC, USDT, ...other
 * popular] (Relay's own `featuredTokens` already comes pre-ordered this way
 * — confirmed live during planning) followed by live trending tokens.
 *
 * Solana is a special case: Jupiter, not Relay, is the execution engine for
 * the source/Sell side (see AGENTS.md), so Solana trending AND search
 * candidates are NOT sourced from or cross-checked against Relay's currency
 * index — that would wrongly narrow Jupiter's much broader liquidity down to
 * only what Relay bridges. Confirmed live: a real, liquid, graduated
 * pump.fun token was completely absent from Relay's index (a legitimate
 * "not indexed for bridging" gap, not a data error) while fully searchable
 * and tradeable via Jupiter's own token search — so Solana search uses
 * Jupiter directly instead. Every other (destination/Buy-side) chain still
 * uses Relay for both, since Relay is the thing that actually has to route
 * to it — an unvalidated pick there would only surface as a confusing quote
 * failure later. (The Buy-side UI additionally restricts Solana picks to
 * native SOL only regardless of what this returns — see SwapPanel.tsx's
 * buyTokenFilter — so this broader Solana search result is always safe to
 * return here even though Buy narrows it further downstream.)
 */
export async function getTokenListForChain(chainId: number, term?: string): Promise<TokenListItem[]> {
  if (term && term.trim().length > 0) {
    return chainId === SOLANA_CHAIN_ID ? searchJupiterTokens(term.trim()) : searchRelayCurrencies(chainId, term.trim());
  }

  const chain = await getRelayChain(chainId);
  if (!chain) return [];

  const featured: TokenListItem[] = chain.featuredTokens.map((t) => ({
    chainId,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoURI: t.logoURI,
    verified: true,
    isNative: t.address.toLowerCase() === chain.nativeCurrency.address.toLowerCase(),
    source: "featured",
  }));

  const featuredAddresses = new Set(featured.map((f) => f.address.toLowerCase()));
  const trendingCandidates = (await getTrendingForChain(chainId)).filter(
    (t) => !featuredAddresses.has(t.address.toLowerCase()),
  );

  if (chainId === SOLANA_CHAIN_ID) {
    return [...featured, ...trendingCandidates];
  }

  const routable = await filterRoutableCurrencies(
    chainId,
    trendingCandidates.map((t) => t.address),
  );
  const trending = trendingCandidates
    .filter((t) => routable.has(t.address.toLowerCase()))
    .map((t) => ({ ...t, verified: routable.get(t.address.toLowerCase())!.verified }));

  return [...featured, ...trending];
}
