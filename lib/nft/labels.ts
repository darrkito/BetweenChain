import type { NftChainFamily, NftVendor } from "@/lib/nft/types";

// Single source of truth for chain-family display names + availability, so
// the browse tabs and breadcrumb trail (app/nft/page.tsx,
// app/nft/[vendor]/[slug]/page.tsx) never drift out of sync with each other.
// `iconUrl` is each chain's real logo — Solana/Ethereum use Relay's own
// asset host (assets.relay.link, already the source for every other chain
// icon in this app via lib/chains/relayChains.ts — confirmed live 2026-07-20,
// not a guessed URL). Relay doesn't cover Sui at all (confirmed live against
// its /chains endpoint, 2026-07-21 — no Move VM entry exists), so Sui's icon
// comes from a different real, verified source instead: CoinGecko's own
// asset CDN, confirmed live 2026-07-22 via CoinGecko's own API
// (`GET /coins/sui` returns `id: "sui", symbol: "sui", name: "Sui"` with
// this exact image URL) — not guessed. Same host this app already trusts
// for pricing (lib/pricing.ts's getSuiUsdPrice/getEthUsdPrice both hit
// CoinGecko's API), just its image CDN instead of its price API.
export const SUI_ICON_URL = "https://coin-images.coingecko.com/coins/images/26375/small/sui-ocean-square.png";

export const NFT_CHAIN_FAMILIES: Array<{ id: NftChainFamily; label: string; available: boolean; iconUrl: string | null }> = [
  { id: "solana", label: "Solana", available: true, iconUrl: "https://assets.relay.link/icons/792703809/light.png" },
  { id: "evm", label: "Ethereum", available: true, iconUrl: "https://assets.relay.link/icons/1/light.png" },
  { id: "move", label: "SUI", available: true, iconUrl: SUI_ICON_URL },
];

export function nftChainFamilyLabel(family: NftChainFamily): string {
  return NFT_CHAIN_FAMILIES.find((f) => f.id === family)?.label ?? family;
}

// Vendor is always in exactly one chain family (see lib/nft/types.ts) — used
// on the collection detail page to know which tab/breadcrumb segment to
// highlight from the `vendor` route param alone, without waiting for the
// collection fetch to resolve.
const VENDOR_FAMILY: Record<NftVendor, NftChainFamily> = {
  magiceden: "solana",
  opensea: "evm",
  tradeport: "move",
};

export function nftFamilyForVendor(vendor: string): NftChainFamily | undefined {
  return VENDOR_FAMILY[vendor as NftVendor];
}
