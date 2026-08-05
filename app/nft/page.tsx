import type { Metadata } from "next";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { NftChainTabs } from "@/app/components/NftChainTabs";
import { EvmChainSubTabs } from "@/app/components/EvmChainSubTabs";
import { NftCollectionsGrid } from "@/app/components/NftCollectionsGrid";
import { NftSearchBar } from "@/app/components/NftSearchBar";
import { nftChainFamilyLabel } from "@/lib/nft/labels";
import { NFT_VENDOR_CLIENTS, VENDOR_FOR_FAMILY } from "@/lib/nft/vendorClients";
import type { NftChainFamily, NftCollection } from "@/lib/nft/types";

type NftBrowseSearchParams = { family?: string; chain?: string; q?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<NftBrowseSearchParams> }): Promise<Metadata> {
  const params = await searchParams;
  const family = (params.family as NftChainFamily | null) ?? "solana";
  const label = nftChainFamilyLabel(family);
  const title = params.q ? `"${params.q}" — ${label} NFTs` : `${label} NFT Collections`;
  const description = `Browse and buy ${label} NFT collections across Solana, Ethereum, and Sui — cross-chain, pay from any wallet.`;
  return { title, description, alternates: { canonical: "/nft" } };
}

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
 *
 * 2026-08-05 — added `?q=` search, routed to NFT_VENDOR_CLIENTS[vendor]
 * .searchCollections instead of .browseCollections when present. Real
 * capability gap, not hidden: OpenSea/Tradeport search is genuinely
 * universal (their real APIs, see lib/nft/{opensea,tradeport}.ts); Magic
 * Eden has no such endpoint for Solana and falls back to filtering a larger
 * fetched pool (see lib/nft/magiceden.ts's searchMagicEdenCollections doc
 * comment) — surfaced to the user via a note under the search bar rather
 * than pretending it's the same guarantee.
 */
export default async function NftBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ family?: string; chain?: string; q?: string }>;
}) {
  const params = await searchParams;
  const family = (params.family as NftChainFamily | null) ?? "solana";
  const evmChain = params.chain ?? "ethereum";
  // Move family defaults to Sui — the only Move chain with buy execution
  // wired up (Aptos/Movement still browse-only, see lib/nft/tradeport.ts).
  // No sub-tab picker like EVM's yet since there's only one wired chain.
  const moveChain = params.chain ?? "sui";
  const chain = family === "evm" ? evmChain : family === "move" ? moveChain : undefined;
  const query = params.q?.trim();

  let collections: NftCollection[] = [];
  let error: string | null = null;
  const vendor = VENDOR_FOR_FAMILY[family] ?? VENDOR_FOR_FAMILY.solana;
  try {
    collections = query
      ? await NFT_VENDOR_CLIENTS[vendor].searchCollections(query, chain)
      : await NFT_VENDOR_CLIENTS[vendor].browseCollections(chain);
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <NftChainTabs active={family} />
      {family === "evm" && <EvmChainSubTabs active={evmChain} />}
      <Breadcrumb items={[{ label: "NFTs", href: "/nft" }, { label: nftChainFamilyLabel(family) }]} />

      <NftSearchBar family={family} chain={chain} initialQuery={query} />
      {query && vendor === "magiceden" && (
        <p className="px-1 text-xs text-ink-faint">
          Solana search checks a large set of collections but isn&apos;t exhaustive — very new or low-volume collections may not
          appear yet.
        </p>
      )}

      {error && (
        <div className="rounded-2xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {!error && collections.length === 0 && (
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-hairline py-16 text-center">
          <p className="text-sm font-medium text-ink">{query ? `No collections found for "${query}"` : "No collections found"}</p>
          <p className="text-sm text-ink-muted">{query ? "Try a different search term." : "Try a different chain."}</p>
          {/*
            2026-08-05 (real user report — "Claynosaurz: The Call of Saga",
            symbol "saga") — Magic Eden's Solana search here draws from a
            fixed, internally-curated pool of ~394 "tracked" collections
            (confirmed live: raising our fetch limit past that returns
            nothing more — it's not a cutoff we control, Magic Eden's own
            data has a hard ceiling there). A real collection with a real
            floor price can be entirely absent from that pool if it doesn't
            clear whatever activity/liquidity threshold Magic Eden applies
            internally. No public API exists to search beyond it (confirmed
            via extensive doc research this session) — this link is the
            only honest way to help a user past that gap. Treats `query` as
            an exact-slug guess (confirmed live: magiceden.io/marketplace/
            {slug} works for a real slug, e.g. "saga") — labeled plainly as
            an external link/guess, not presented as guaranteed to work or
            as equivalent to our own in-app search.
          */}
          {query && vendor === "magiceden" && (
            <a
              href={`https://magiceden.io/marketplace/${encodeURIComponent(query.toLowerCase().replace(/\s+/g, "-"))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 text-xs font-medium text-accent hover:underline"
            >
              Try &quot;{query}&quot; on magiceden.io directly ↗
            </a>
          )}
        </div>
      )}

      {collections.length > 0 && <NftCollectionsGrid collections={collections} />}
    </main>
  );
}
