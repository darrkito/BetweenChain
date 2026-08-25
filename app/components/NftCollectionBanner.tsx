"use client";

import { useState } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/client/imageProxy";

// Decorative collection banner (blurred crop of imageUrl when no real
// bannerImageUrl exists) — shared by NftCollectionHero.tsx and
// NftCollectionsGrid.tsx. Real gap found live 2026-08-25 (user-reported
// "images not loading" on both Sui and Solana collections): both call sites
// used a raw next/image with NO onError handler, unlike the small circular
// avatar elsewhere (NftImage.tsx's own retry-chain + fallbackSrc). Since
// this banner is the single largest, most visually dominant element on
// every card/hero, a failed load here reads as "the whole thing is broken"
// even when the avatar recovers fine. Purely decorative (aria-hidden) — on
// error this just stops rendering the image, rather than plumbing the full
// IPFS-gateway retry chain into a presentational-only slot.
export function NftCollectionBanner({ src, sizes, className }: { src: string; sizes: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image src={proxiedImageUrl(src)} alt="" aria-hidden="true" fill sizes={sizes} onError={() => setFailed(true)} className={className} />
  );
}
