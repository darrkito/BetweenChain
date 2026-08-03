"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { NftChainTabs } from "@/app/components/NftChainTabs";
import { EvmChainSubTabs } from "@/app/components/EvmChainSubTabs";
import { NftCollectionsGrid, NftCollectionsGridSkeleton } from "@/app/components/NftCollectionsGrid";
import { nftChainFamilyLabel } from "@/lib/nft/labels";
import type { NftCollection, NftChainFamily } from "@/lib/nft/types";

function NftBrowseContent() {
  // Tab state lives in the URL (?family=, and for EVM also ?chain=) rather
  // than local useState, so NftChainTabs/EvmChainSubTabs can be plain
  // link-based components shared with the collection detail page (which has
  // no local tab state of its own).
  const searchParams = useSearchParams();
  const family = (searchParams.get("family") as NftChainFamily | null) ?? "solana";
  const evmChain = searchParams.get("chain") ?? "ethereum";
  // Move family defaults to Sui — the only Move chain with buy execution
  // wired up (Aptos/Movement still browse-only, see lib/nft/tradeport.ts).
  // No sub-tab picker like EVM's yet since there's only one wired chain.
  const moveChain = searchParams.get("chain") ?? "sui";

  const [collections, setCollections] = useState<NftCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    // Reset inside the promise chain (not synchronously in the effect body)
    // so switching tabs clears stale data and shows the loading state
    // without the "set-state-in-effect" lint violation.
    Promise.resolve()
      .then(() => {
        if (ignore) return;
        setLoading(true);
        setError(null);
        setCollections([]);
      })
      .then(() =>
        fetch(
          `/api/nft/collections?chainFamily=${family}${family === "evm" ? `&chain=${evmChain}` : family === "move" ? `&chain=${moveChain}` : ""}`,
        ),
      )
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load collections");
        return body as { collections: NftCollection[] };
      })
      .then((body) => {
        if (!ignore) setCollections(body.collections);
      })
      .catch((err) => {
        if (!ignore) setError((err as Error).message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [family, evmChain, moveChain]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <NftChainTabs active={family} />
      {family === "evm" && <EvmChainSubTabs active={evmChain} />}
      <Breadcrumb items={[{ label: "NFTs", href: "/nft" }, { label: nftChainFamilyLabel(family) }]} />

      {error && (
        <div className="rounded-2xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {!loading && !error && collections.length === 0 && (
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-hairline py-16 text-center">
          <p className="text-sm font-medium text-ink">No collections found</p>
          <p className="text-sm text-ink-muted">Try a different chain.</p>
        </div>
      )}

      {loading ? (
        <NftCollectionsGridSkeleton />
      ) : (
        collections.length > 0 && <NftCollectionsGrid collections={collections} />
      )}
    </main>
  );
}

export default function NftBrowsePage() {
  return (
    <Suspense fallback={null}>
      <NftBrowseContent />
    </Suspense>
  );
}
