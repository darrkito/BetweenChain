import "server-only";
import { cached } from "@/lib/cache";

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_PRICE_API = "https://lite-api.jup.ag/price/v3";

/**
 * All swap USD volume in this app is priced off native SOL, not the source
 * meme coin directly: every route passes through a SOL checkpoint (either
 * the user's starting SOL amount, or leg 1's Jupiter output), which sidesteps
 * needing per-mint decimals/liquidity lookups for arbitrary SPL tokens.
 *
 * NOTE: `price/v2` (the original endpoint here) was retired by Jupiter at
 * some point after this was first written and returned a bare 404 — this
 * silently broke points crediting in both app/api/swap/confirm and
 * app/api/bridge/confirm (both call this before creditSwapPoints) until
 * caught live during unrelated preview-feature testing. v3's response shape
 * differs: flat `{[mint]: {usdPrice}}`, not `{data: {[mint]: {price}}}`.
 */
export async function getSolUsdPrice(): Promise<number> {
  const res = await fetch(`${JUPITER_PRICE_API}?ids=${NATIVE_SOL_MINT}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Price lookup failed (${res.status})`);
  const body = await res.json();
  const price = Number(body?.[NATIVE_SOL_MINT]?.usdPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid SOL price response");
  return price;
}

export function lamportsToUsd(lamports: string | number, solUsdPrice: number): number {
  return (Number(lamports) / 1e9) * solUsdPrice;
}

// Jupiter's price API only covers Solana SPL mints — no ETH. Used by
// same-chain NFT purchases (see app/api/nft/purchase/quote/route.ts) to
// compute USD volume for points crediting, since those never touch a Relay
// quote (which is where every other USD figure in this app comes from —
// Relay's own quote-time valuation).
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_SIMPLE_PRICE_API = `${COINGECKO_API_BASE}/simple/price`;

export async function getEthUsdPrice(): Promise<number> {
  const res = await fetch(`${COINGECKO_SIMPLE_PRICE_API}?ids=ethereum&vs_currencies=usd`, { cache: "no-store" });
  if (!res.ok) throw new Error(`ETH price lookup failed (${res.status})`);
  const body = await res.json();
  const price = Number(body?.ethereum?.usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid ETH price response");
  return price;
}

export function weiToUsd(wei: string | number, ethUsdPrice: number): number {
  return (Number(wei) / 1e18) * ethUsdPrice;
}

// Same role as getEthUsdPrice, for Sui NFT purchases' points-crediting USD
// volume: same-chain Sui purchases never touch a Relay/Squid quote (no
// bridging leg to read a USD figure from), and even the cross-chain ETH→SUI
// path's Squid quote may not carry a reliable destination-side USD value —
// this is the fallback either way.
export async function getSuiUsdPrice(): Promise<number> {
  const res = await fetch(`${COINGECKO_SIMPLE_PRICE_API}?ids=sui&vs_currencies=usd`, { cache: "no-store" });
  if (!res.ok) throw new Error(`SUI price lookup failed (${res.status})`);
  const body = await res.json();
  const price = Number(body?.sui?.usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid SUI price response");
  return price;
}

export function mistToUsd(mist: string | number, suiUsdPrice: number): number {
  return (Number(mist) / 1e9) * suiUsdPrice;
}

// Same role as getEthUsdPrice/getSuiUsdPrice, for BTC-origin NFT purchases'
// points-crediting USD volume (2026-08-08, ChangeNOW BTC support).
export async function getBtcUsdPrice(): Promise<number> {
  const res = await fetch(`${COINGECKO_SIMPLE_PRICE_API}?ids=bitcoin&vs_currencies=usd`, { cache: "no-store" });
  if (!res.ok) throw new Error(`BTC price lookup failed (${res.status})`);
  const body = await res.json();
  const price = Number(body?.bitcoin?.usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid BTC price response");
  return price;
}

// chainId -> CoinGecko's own platform slug, for the per-contract price
// endpoint below. Matches lib/chains/evm.ts's CHAIN_CONFIG exactly — the
// same 6 chains this app has a real RPC client for (no point pricing a
// chain we can't even fetch balances on).
const COINGECKO_PLATFORM_FOR_CHAIN: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  137: "polygon-pos",
  42161: "arbitrum-one",
  10: "optimistic-ethereum",
  43114: "avalanche",
  // Swap-only EVM chains (2026-08-18) — matched against CoinGecko's live
  // /api/v3/asset_platforms response by chain_identifier, not guessed.
  // b3 (8333) and bob (60808) have no CoinGecko platform yet — omitted
  // rather than guessing; those chains' tokens just show no USD price.
  2741: "abstract",
  33139: "apechain",
  42170: "arbitrum-nova",
  56: "binance-smart-chain",
  80094: "berachain",
  81457: "blast",
  288: "boba",
  42220: "celo",
  25: "cronos",
  666666666: "degen",
  100: "xdai",
  43419: "gunz",
  57073: "ink",
  747474: "katana",
  59144: "linea",
  1135: "lisk",
  169: "manta-pacific",
  5000: "mantle",
  4326: "megaeth",
  34443: "mode",
  143: "monad",
  2818: "morph-l2",
  9745: "plasma",
  98866: "plume-network",
  2020: "ronin",
  534352: "scroll",
  1329: "sei-v2",
  360: "shape",
  5031: "somnia",
  1868: "soneium",
  146: "sonic",
  988: "stable",
  5330: "superseed",
  130: "unichain",
  480: "world-chain",
  48900: "zircuit",
  7777777: "zora-network",
  324: "zksync",
};

const TOKEN_PRICE_TTL_MS = 60_000;

/**
 * USD price for a batch of EVM token contract addresses on one chain — used
 * by the wallet-holdings picker (app/api/tokens/balances/route.ts) to price
 * whatever the connected wallet actually holds. CoinGecko's anonymous tier
 * only allows ONE contract address per request (confirmed live — a real
 * multi-address request 400s with "exceeds the allowed limit of 1 contract
 * address"), so this fires one request per address in parallel rather than
 * a single batched call. Each lookup is independently wrapped so one
 * failing/unlisted token doesn't drop USD prices for the rest of the
 * wallet's holdings — a missing entry in the returned map just means that
 * token shows balance with no $ figure, not a broken picker. Cached
 * per-address (not per-batch) so overlapping requests for the same token
 * across different wallets/chains share one cache entry.
 */
export async function getEvmTokenUsdPrices(chainId: number, addresses: string[]): Promise<Record<string, number>> {
  const platform = COINGECKO_PLATFORM_FOR_CHAIN[chainId];
  if (!platform || addresses.length === 0) return {};

  const entries = await Promise.all(
    addresses.map(async (address) => {
      const lower = address.toLowerCase();
      const price = await cached(`token-usd-price:${chainId}:${lower}`, TOKEN_PRICE_TTL_MS, async () => {
        const res = await fetch(
          `${COINGECKO_API_BASE}/simple/token_price/${platform}?contract_addresses=${lower}&vs_currencies=usd`,
          { cache: "no-store" },
        );
        if (!res.ok) return null;
        const body = await res.json();
        const value = Number(body?.[lower]?.usd);
        return Number.isFinite(value) && value > 0 ? value : null;
      }).catch(() => null);
      return [lower, price] as const;
    }),
  );

  const result: Record<string, number> = {};
  for (const [address, price] of entries) {
    if (price != null) result[address] = price;
  }
  return result;
}

// CoinGecko doesn't have a "native asset" entry under its token_price-by-
// contract endpoint (address 0x00...00 isn't a listed contract) -- a
// handful of EVM chains' native currencies with obvious, unambiguous
// CoinGecko ids, matched by hand the same way COINGECKO_PLATFORM_FOR_CHAIN
// above is: chains not in either map here just show no native $ figure
// rather than a guessed one (same precedent as that map's own comment).
const EVM_NATIVE_COINGECKO_ID: Record<number, string> = {
  1: "ethereum",
  8453: "ethereum",
  42161: "ethereum",
  10: "ethereum",
  137: "matic-network", // Polygon (MATIC/POL)
  56: "binancecoin", // BNB Chain
  43114: "avalanche-2", // Avalanche (AVAX)
};

const NATIVE_PRICE_TTL_MS = 60_000;

/**
 * USD price for an EVM chain's native gas currency, for chains beyond the
 * 4 already covered by getEthUsdPrice's fixed "ethereum" id. Used by
 * SwapPanel's Sell-side USD (2026-08-18) — that display previously only
 * ever covered native SOL, leaving every EVM sell token (native or ERC20)
 * with no $ figure at all.
 */
export async function getEvmNativeUsdPrice(chainId: number): Promise<number | null> {
  const id = EVM_NATIVE_COINGECKO_ID[chainId];
  if (!id) return null;
  return cached(`native-usd-price:${chainId}`, NATIVE_PRICE_TTL_MS, async () => {
    const res = await fetch(`${COINGECKO_SIMPLE_PRICE_API}?ids=${id}&vs_currencies=usd`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    const value = Number(body?.[id]?.usd);
    return Number.isFinite(value) && value > 0 ? value : null;
  }).catch(() => null);
}

const MINT_PRICE_TTL_MS = 30_000;

/**
 * USD price for an arbitrary batch of Solana SPL mints in one call —
 * Jupiter's price/v3 (same endpoint getSolUsdPrice already uses) genuinely
 * supports comma-separated multi-mint requests (confirmed live: a real
 * two-mint request returned both entries, each with its own `usdPrice` and
 * `decimals`), unlike CoinGecko's EVM per-contract endpoint above which is
 * one-address-per-request. Used by the Dust Sweeper's Solana scan to price
 * whatever the connected wallet actually holds — not just the app's own
 * curated token list (see app/api/tokens/balances/route.ts's narrower
 * scope) — since real dust is disproportionately unlisted/rug tokens. A
 * mint with no Jupiter liquidity simply doesn't appear in the response
 * (never fabricated as 0 or omitted-as-error).
 */
export async function getJupiterMintUsdPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const unique = Array.from(new Set(mints));

  const entries = await Promise.all(
    unique.map(async (mint) => {
      const price = await cached(`jupiter-mint-price:${mint}`, MINT_PRICE_TTL_MS, async () => {
        const res = await fetch(`${JUPITER_PRICE_API}?ids=${mint}`, { cache: "no-store" });
        if (!res.ok) return null;
        const body = await res.json();
        const value = Number(body?.[mint]?.usdPrice);
        return Number.isFinite(value) && value > 0 ? value : null;
      }).catch(() => null);
      return [mint, price] as const;
    }),
  );

  const result: Record<string, number> = {};
  for (const [mint, price] of entries) {
    if (price != null) result[mint] = price;
  }
  return result;
}

export function formatAtomicAmount(atomic: string, decimals: number): string {
  const value = Number(atomic) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: Math.min(decimals, 6) });
}
