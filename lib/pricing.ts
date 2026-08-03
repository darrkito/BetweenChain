import "server-only";

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
const COINGECKO_SIMPLE_PRICE_API = "https://api.coingecko.com/api/v3/simple/price";

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

export function formatAtomicAmount(atomic: string, decimals: number): string {
  const value = Number(atomic) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: Math.min(decimals, 6) });
}
