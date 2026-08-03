import "server-only";
import { cached } from "@/lib/cache";
import { getRelayChain } from "@/lib/chains/relayChains";
import type { TokenListItem } from "@/lib/chains/types";

const JUPITER_TOKENS_API = "https://lite-api.jup.ag/tokens/v2";
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2";
const SOLANA_CHAIN_ID = 792703809;
const TRENDING_TTL_MS = 60_000;

// Relay chainId -> GeckoTerminal network slug. Chains outside this map get no
// trending row (featured + search still work) — fast-follow to extend, not a
// blocker for v1.
const GECKOTERMINAL_NETWORK_SLUGS: Record<number, string> = {
  1: "eth",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon_pos",
  56: "bsc",
  43114: "avax",
};

interface JupiterTrendingToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  organicScoreLabel?: string;
}

interface GeckoTerminalIncluded {
  id: string;
  type: string;
  attributes: { address: string; name: string; symbol: string; decimals: number; image_url?: string };
}

interface GeckoTerminalPool {
  relationships?: {
    base_token?: { data?: { id: string } };
    quote_token?: { data?: { id: string } };
  };
}

export async function getTrendingForChain(chainId: number): Promise<TokenListItem[]> {
  return cached(`trending:${chainId}`, TRENDING_TTL_MS, () =>
    chainId === SOLANA_CHAIN_ID ? getSolanaTrending() : getEvmTrending(chainId),
  );
}

async function getSolanaTrending(): Promise<TokenListItem[]> {
  const res = await fetch(`${JUPITER_TOKENS_API}/toptrending/24h?limit=20`, { cache: "no-store" });
  if (!res.ok) return [];
  const tokens = (await res.json()) as JupiterTrendingToken[];

  return tokens.map((t) => ({
    chainId: SOLANA_CHAIN_ID,
    address: t.id,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoURI: t.icon ?? "",
    verified: t.organicScoreLabel === "high",
    isNative: false,
    source: "trending" as const,
  }));
}

async function getEvmTrending(chainId: number): Promise<TokenListItem[]> {
  const slug = GECKOTERMINAL_NETWORK_SLUGS[chainId];
  if (!slug) return [];

  const chain = await getRelayChain(chainId);
  const majors = new Set(
    [chain?.nativeCurrency.symbol, chain?.nativeCurrency.symbol ? `W${chain.nativeCurrency.symbol}` : undefined, "USDC", "USDT"]
      .filter((s): s is string => Boolean(s))
      .map((s) => s.toUpperCase()),
  );

  const res = await fetch(
    `${GECKOTERMINAL_API}/networks/${slug}/trending_pools?include=base_token,quote_token&limit=20`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: GeckoTerminalPool[]; included?: GeckoTerminalIncluded[] };

  const included = new Map<string, GeckoTerminalIncluded>();
  for (const item of body.included ?? []) included.set(item.id, item);

  const seen = new Set<string>();
  const results: TokenListItem[] = [];

  for (const pool of body.data ?? []) {
    const baseId = pool.relationships?.base_token?.data?.id;
    const quoteId = pool.relationships?.quote_token?.data?.id;
    const base = baseId ? included.get(baseId) : undefined;
    const quote = quoteId ? included.get(quoteId) : undefined;

    // Whichever side isn't a known major (native/wrapped-native/USDC/USDT) is
    // the actually-interesting trending token; if both sides are majors,
    // this pool tells us nothing new, skip it.
    const candidate = pickNonMajor(base, majors) ?? pickNonMajor(quote, majors);
    if (!candidate) continue;

    const address = candidate.attributes.address.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);

    results.push({
      chainId,
      address: candidate.attributes.address,
      symbol: candidate.attributes.symbol,
      name: candidate.attributes.name,
      decimals: candidate.attributes.decimals,
      logoURI: candidate.attributes.image_url ?? "",
      verified: false,
      isNative: false,
      source: "trending",
    });
  }

  return results;
}

function pickNonMajor(token: GeckoTerminalIncluded | undefined, majors: Set<string>): GeckoTerminalIncluded | undefined {
  if (!token) return undefined;
  return majors.has(token.attributes.symbol.toUpperCase()) ? undefined : token;
}
