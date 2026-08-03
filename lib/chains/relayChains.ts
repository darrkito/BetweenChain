import "server-only";
import { cached } from "@/lib/cache";
import type { ChainInfo } from "@/lib/chains/types";

const RELAY_API = process.env.RELAY_API ?? "https://api.relay.link";
const CHAINS_TTL_MS = 5 * 60_000;

interface RawRelayChain {
  id: number;
  name: string;
  displayName: string;
  iconUrl?: string | null;
  logoUrl?: string | null;
  vmType: string;
  currency: { symbol: string; address: string; decimals: number };
  featuredTokens?: Array<{
    id: string;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    metadata?: { logoURI?: string };
  }>;
}

export async function getRelayChains(): Promise<ChainInfo[]> {
  return cached("relay:chains", CHAINS_TTL_MS, async () => {
    const res = await fetch(`${RELAY_API}/chains`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Relay /chains failed (${res.status})`);
    const body = (await res.json()) as { chains: RawRelayChain[] };

    return body.chains.map((c) => ({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      iconUrl: c.iconUrl ?? c.logoUrl ?? null,
      vmType: c.vmType,
      nativeCurrency: c.currency,
      featuredTokens: (c.featuredTokens ?? []).map((t) => ({
        id: t.id,
        symbol: t.symbol,
        name: t.name,
        address: t.address,
        decimals: t.decimals,
        logoURI: t.metadata?.logoURI ?? "",
      })),
    }));
  });
}

export async function getRelayChain(chainId: number): Promise<ChainInfo | undefined> {
  const chains = await getRelayChains();
  return chains.find((c) => c.id === chainId);
}
