import type { NftListing } from "@/lib/nft/types";

// Split out from cryptopunksOnchain.ts deliberately — that file pulls in
// "server-only" modules (lib/cache.ts, lib/chains/evm.ts's viem client), and
// the buy grid (app/nft/[vendor]/[slug]/page.tsx) is a "use client" component
// that needs isOnchainPunkListing to decide whether to show a live "Buy"
// button. Importing the server-only file directly from there broke the
// client bundle (confirmed live 2026-08-03: "You're importing a module that
// depends on server-only ... in the Pages Router" even though this is the
// App Router — the real cause was the transitive server-only import, not a
// router mismatch). This file has zero server-only dependencies so both
// sides can share it safely.

export const CRYPTOPUNKS_SLUG = "cryptopunks";

export interface OnchainPunkListingRaw {
  source: "cryptopunks-onchain";
  punkIndex: number;
  seller: string;
  minValueWei: string;
}

export function isOnchainPunkListing(l: NftListing): boolean {
  return (l.raw as OnchainPunkListingRaw | undefined)?.source === "cryptopunks-onchain";
}
