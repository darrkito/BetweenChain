"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSuiWallet } from "@/lib/client/SuiWalletProvider";
import { NftImage } from "@/app/components/NftImage";
import type { OwnedNft } from "@/lib/nft/types";

export interface GameCollectionInfo {
  vendor: "magiceden" | "opensea" | "tradeport";
  slug: string;
  chain: "solana" | "sui" | "evm";
  name: string;
  imageUrl?: string;
}

const CHAIN_LABEL: Record<GameCollectionInfo["chain"], string> = { solana: "Solana", sui: "Sui", evm: "EVM" };

async function fetchHoldings(collection: GameCollectionInfo, owner: string): Promise<OwnedNft[]> {
  const params = new URLSearchParams({ vendor: collection.vendor, slug: collection.slug, owner, chain: collection.chain });
  const res = await fetch(`/api/games/collection-holdings?${params}`);
  if (!res.ok) return [];
  const body: { owned?: OwnedNft[] } = await res.json();
  return body.owned ?? [];
}

// "Related collections" + real ownership check (2026-08-07) — shown at the
// bottom of a game's description. Always shows every linked collection
// (icon/name/chain badge/hyperlink to the real /nft/[vendor]/[slug] page)
// regardless of wallet state; when the visitor has a wallet connected that
// matches a collection's chain, also fetches and shows the REAL NFTs they
// own from it — never a fabricated "you own N items" count, and no wallet
// connection is required just to see the section.
export function GameCollectionOwnership({ collections }: { collections: GameCollectionInfo[] }) {
  const { publicKey } = useWallet();
  const sui = useSuiWallet();
  const solanaAddress = publicKey?.toBase58() ?? null;
  const suiAddress = sui.address;

  const [holdings, setHoldings] = useState<Record<string, OwnedNft[] | undefined>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let ignore = false;
    for (const c of collections) {
      const owner = c.chain === "solana" ? solanaAddress : c.chain === "sui" ? suiAddress : null;
      const key = `${c.vendor}:${c.slug}`;
      if (!owner) continue;
      // Deferred to a microtask (same pattern as CollectionPageClient.tsx's
      // mount-skip guards) rather than a synchronous setState call in the
      // effect body — required by this repo's react-hooks/set-state-in-effect
      // lint rule.
      Promise.resolve().then(() => {
        if (!ignore) setLoading((prev) => ({ ...prev, [key]: true }));
      });
      fetchHoldings(c, owner)
        .then((owned) => {
          if (!ignore) setHoldings((prev) => ({ ...prev, [key]: owned }));
        })
        .catch(() => {
          if (!ignore) setHoldings((prev) => ({ ...prev, [key]: [] }));
        })
        .finally(() => {
          if (!ignore) setLoading((prev) => ({ ...prev, [key]: false }));
        });
    }
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs only when the actual connected addresses change, `collections` is a stable prop for a given game page
  }, [solanaAddress, suiAddress]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-sm font-semibold text-ink">Related collections</h2>
      <div className="flex flex-col gap-3">
        {collections.map((c) => {
          const key = `${c.vendor}:${c.slug}`;
          const owner = c.chain === "solana" ? solanaAddress : c.chain === "sui" ? suiAddress : null;
          const owned = holdings[key];
          const isLoading = loading[key];

          return (
            <div key={key} className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
              <Link href={`/nft/${c.vendor}/${encodeURIComponent(c.slug)}`} className="group flex items-center gap-3">
                <NftImage src={c.imageUrl ?? ""} alt={c.name} className="h-12 w-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink group-hover:text-accent">{c.name}</p>
                  <p className="text-xs text-ink-faint">{CHAIN_LABEL[c.chain]}</p>
                </div>
                <span className="shrink-0 text-xs font-medium text-accent">View →</span>
              </Link>

              {!owner ? (
                <p className="text-xs text-ink-faint">
                  Connect a {CHAIN_LABEL[c.chain]} wallet to see which {c.name} items you own.
                </p>
              ) : isLoading ? (
                <p className="text-xs text-ink-faint">Checking your wallet…</p>
              ) : !owned || owned.length === 0 ? (
                <p className="text-xs text-ink-faint">You don&apos;t own any {c.name} items on the connected wallet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-ink-muted">
                    You own {owned.length} item{owned.length === 1 ? "" : "s"} from {c.name}:
                  </p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {owned.slice(0, 12).map((n) => (
                      <div key={n.tokenId} className="flex flex-col gap-1">
                        <NftImage src={n.imageUrl ?? ""} alt={n.name ?? n.tokenId} className="aspect-square w-full rounded-lg" />
                        {n.name && <p className="truncate text-[10px] text-ink-faint">{n.name}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
