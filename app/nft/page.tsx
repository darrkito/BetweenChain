import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { NftChainTabs } from "@/app/components/NftChainTabs";
import { EvmChainSubTabs } from "@/app/components/EvmChainSubTabs";
import { NftCollectionsGrid } from "@/app/components/NftCollectionsGrid";
import { NftSearchBar } from "@/app/components/NftSearchBar";
import { nftChainFamilyLabel } from "@/lib/nft/labels";
import { NFT_VENDOR_CLIENTS, VENDOR_FOR_FAMILY } from "@/lib/nft/vendorClients";
import type { NftChainFamily, NftCollection } from "@/lib/nft/types";
import { JsonLd, faqPageSchema, breadcrumbListSchema } from "@/lib/seo/jsonld";
import { NFT_FAQ_ITEMS } from "@/lib/content/nftFaq";

const SITE_URL = "https://blockchains.click";

type NftBrowseSearchParams = { family?: string; chain?: string; q?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<NftBrowseSearchParams> }): Promise<Metadata> {
  const params = await searchParams;
  const family = (params.family as NftChainFamily | null) ?? "solana";
  const label = nftChainFamilyLabel(family);
  const title = params.q ? `"${params.q}" — ${label} NFTs` : `${label} NFT Collections`;
  const description = `Browse and buy ${label} NFT collections across Solana, Ethereum, and Sui — cross-chain, pay from any wallet.`;
  // Real bug found live 2026-08-19 (homegrown crawl audit, alongside the
  // sitemap fix above it): this always canonicalized to bare "/nft"
  // regardless of family, which is right for a `?q=` search (transient,
  // genuinely should defer to the base view) but wrong for `?family=evm`/
  // `?family=move` -- those are stable, meaningfully different content
  // (different real collections), not a duplicate of the Solana-only
  // default. Self-canonicalizing them away would have undermined adding
  // them to the sitemap: Google generally won't index a page separately
  // when its own canonical tag says the "real" version is elsewhere.
  const canonical = family === "solana" ? "/nft" : `/nft?family=${family}`;
  return { title, description, alternates: { canonical } };
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
      {/* 2026-08-06 (frontend audit, Impeccable detector: "flat-type-hierarchy")
          — this page previously jumped straight from AppHeader into the chain
          tabs with no page-level heading at all, so every text size on the
          page clustered in the 10-16px range with nothing bigger to anchor a
          real scale. A real h1 fixes both the flagged hierarchy issue and a
          genuine wayfinding gap (no page ever said what page you were on). */}
      <h1 className="font-display px-1 text-2xl font-normal text-ink sm:text-3xl">NFT Marketplace</h1>
      {/* Strengthened 2026-08-18 (SEO Tier 2) — was a single generic
          sentence with no direct-answer opening (see the SEO playbook's
          §2). Real gap: this page's genuine differentiator — pay for an
          NFT with a token from a different chain than the NFT itself — was
          never actually stated on the page a crawler/AI system would
          extract from; it only ever lived in marketing copy elsewhere
          (homepage, llms.txt). */}
      <p className="px-1 text-sm text-ink-muted">
        Buy an NFT on Solana, Ethereum, or Sui and pay with a token from a different chain than the NFT itself — no manual
        bridging first. Real, live listings from Magic Eden, OpenSea, and Tradeport. New to buying across chains? See{" "}
        <Link href="/blog/solana-vs-ethereum-nfts" className="text-accent hover:underline">
          what actually differs between Solana and Ethereum NFTs
        </Link>
        .
      </p>
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

      {/* Added 2026-08-18 (SEO Tier 2) — this page had no FAQ/structured
          content at all before this, unlike every other high-traffic page
          on the site (homepage, /faq, every /swap/[pair] page). Distinct
          questions from lib/content/faq.ts's site-wide FAQ_ITEMS on
          purpose — see nftFaq.ts's own doc on why (avoids the SEO
          playbook's §5 sibling-page content-overlap concern). */}
      <section className="mt-4 flex flex-col gap-3">
        <h2 className="px-1 text-lg font-semibold text-ink">Frequently asked questions</h2>
        <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-surface shadow-sm">
          {NFT_FAQ_ITEMS.map((item) => (
            <div key={item.question} className="flex flex-col gap-2 p-5">
              <h3 className="text-base font-semibold text-ink">{item.question}</h3>
              <p className="max-w-[65ch] text-sm text-ink-muted">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>

      <JsonLd data={faqPageSchema(NFT_FAQ_ITEMS)} />
      <JsonLd
        data={breadcrumbListSchema([{ label: "NFTs", href: "/nft" }, { label: nftChainFamilyLabel(family) }], `${SITE_URL}/nft`)}
      />
    </main>
  );
}
