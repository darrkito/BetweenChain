import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { NftChainTabs } from "@/app/components/NftChainTabs";
import { EvmChainSubTabs } from "@/app/components/EvmChainSubTabs";
import { NftCollectionsGrid } from "@/app/components/NftCollectionsGrid";
import { nftChainFamilyLabel } from "@/lib/nft/labels";
import { NFT_VENDOR_CLIENTS, VENDOR_FOR_FAMILY } from "@/lib/nft/vendorClients";
import type { NftChainFamily, NftCollection } from "@/lib/nft/types";

/**
 * 2026-08-04 (performance pass) — converted from a client component that
 * fetched /api/nft/collections on mount (loading spinner, then a second
 * paint once data arrived) to a Server Component that fetches directly
 * server-side and renders with the real data on the FIRST paint. Safe to
 * do here specifically because this page's only "state" was already
 * driven entirely by the URL (?family=, ?chain=) via plain <Link>
 * navigations in NftChainTabs/EvmChainSubTabs, not local client state —
 * every tab switch was already a full Next.js navigation under the hood,
 * so there was no real interactivity being given up by moving the fetch
 * server-side. Calls the vendor client functions directly (no HTTP
 * roundtrip to our own /api/nft/collections route, which stays in place
 * for now in case anything else needs it client-side later) — one fewer
 * network hop than the old fetch('/api/nft/collections...') did.
 *
 * NftCollectionsGrid itself stays a client component (it has real local
 * state — sort key/direction) and now just receives the server-fetched
 * `collections` directly as a prop instead of fetching them itself.
 *
 * Errors render inline rather than throwing into error.tsx — matches the
 * existing inline-banner style already used on every other page in this
 * app (see the collection detail page), not a framework-default error UI.
 */
export default async function NftBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ family?: string; chain?: string }>;
}) {
  const params = await searchParams;
  const family = (params.family as NftChainFamily | null) ?? "solana";
  const evmChain = params.chain ?? "ethereum";
  // Move family defaults to Sui — the only Move chain with buy execution
  // wired up (Aptos/Movement still browse-only, see lib/nft/tradeport.ts).
  // No sub-tab picker like EVM's yet since there's only one wired chain.
  const moveChain = params.chain ?? "sui";
  const chain = family === "evm" ? evmChain : family === "move" ? moveChain : undefined;

  let collections: NftCollection[] = [];
  let error: string | null = null;
  const vendor = VENDOR_FOR_FAMILY[family] ?? VENDOR_FOR_FAMILY.solana;
  try {
    collections = await NFT_VENDOR_CLIENTS[vendor].browseCollections(chain);
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <NftChainTabs active={family} />
      {family === "evm" && <EvmChainSubTabs active={evmChain} />}
      <Breadcrumb items={[{ label: "NFTs", href: "/nft" }, { label: nftChainFamilyLabel(family) }]} />

      {error && (
        <div className="rounded-2xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {!error && collections.length === 0 && (
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-hairline py-16 text-center">
          <p className="text-sm font-medium text-ink">No collections found</p>
          <p className="text-sm text-ink-muted">Try a different chain.</p>
        </div>
      )}

      {collections.length > 0 && <NftCollectionsGrid collections={collections} />}
    </main>
  );
}
