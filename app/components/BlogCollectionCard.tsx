"use client";

import { useEffect, useState } from "react";
import { TokenIcon } from "@/app/components/TokenIcon";
import { formatUsdCompact } from "@/lib/client/amount";

interface CollectionData {
  name: string;
  imageUrl?: string;
  floorPrice?: string;
  floorPriceCurrency?: string;
}

// Live NFT collection card, embeddable in a blog post's .mdx body — same
// role/pattern as BlogTokenStats.tsx (client component, fetch after mount,
// never a hardcoded floor price baked into static post content). `chain`
// is only meaningful for Tradeport (Sui) collections — see
// app/api/nft/collection/route.ts's own `chain` param doc; ignored
// otherwise. `priceSymbol` picks which /api/tokens/price?symbol= lookup
// converts the native floor into a $ estimate (sol|sui) — undefined skips
// the USD conversion entirely rather than guessing a rate.
export function BlogCollectionCard({
  vendor,
  slug,
  chain,
  priceSymbol,
  href,
}: {
  vendor: "magiceden" | "opensea" | "tradeport";
  slug: string;
  chain?: string;
  priceSymbol?: "sol" | "sui";
  href: string;
}) {
  const [collection, setCollection] = useState<CollectionData | null | undefined>(undefined);
  const [usdPrice, setUsdPrice] = useState<number | null>(null);

  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams({ vendor, slug });
    if (chain) params.set("chain", chain);
    fetch(`/api/nft/collection?${params}`)
      .then((r) => (r.ok ? r.json() : { collection: null }))
      .then((body: { collection: CollectionData | null }) => {
        if (!ignore) setCollection(body.collection);
      })
      .catch(() => {
        if (!ignore) setCollection(null);
      });

    if (priceSymbol) {
      fetch(`/api/tokens/price?symbol=${priceSymbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { solUsdPrice?: number; suiUsdPrice?: number } | null) => {
          const price = body?.solUsdPrice ?? body?.suiUsdPrice ?? null;
          if (!ignore && price) setUsdPrice(price);
        })
        .catch(() => {});
    }

    return () => {
      ignore = true;
    };
  }, [vendor, slug, chain, priceSymbol]);

  if (collection === null) return null;

  const floorNative = collection?.floorPrice ? Number(collection.floorPrice) : null;
  const floorUsd = floorNative != null && usdPrice != null ? floorNative * usdPrice : null;

  return (
    <a
      href={href}
      className="my-2 flex items-center gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm transition-all hover:border-accent/40"
    >
      <TokenIcon logoURI={collection?.imageUrl ?? ""} symbol={collection?.name ?? slug} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{collection === undefined ? "…" : (collection?.name ?? slug)}</p>
        {floorNative != null && (
          <p className="num text-xs text-ink-faint">
            Floor: {floorNative} {collection?.floorPriceCurrency ?? ""}
            {floorUsd != null && ` (~${formatUsdCompact(floorUsd)})`}
          </p>
        )}
      </div>
      <span className="shrink-0 text-sm font-semibold text-accent">View →</span>
    </a>
  );
}
