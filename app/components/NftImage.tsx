"use client";

import { useState } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/client/imageProxy";

// Alternate public IPFS gateways to retry a CID against before giving up —
// added 2026-08-04 after a real live investigation (user-reported: Okay
// Bears/Market Elites on Solana, several Sui collections all showing broken
// PFPs). Confirmed each failure individually: some (Popkins' Walrus blob,
// DeSuiLabs' dead Shadow Drive DNS, SuiFrens' own API 500ing, BlueMove's
// gateway 404ing) are genuinely dead at the source — no gateway retry can
// fix those, only the primary `fallbackSrc` mechanism below applies. But
// IPFS content is content-addressed: the SAME CID is often still reachable
// via a DIFFERENT public gateway even when the one the vendor happened to
// return is down (confirmed live: w3s.link redirects to dweb.link, which
// 504s for Okay Bears' specific CID on every gateway tried — that one truly
// is down everywhere right now, but this is a real, zero-extra-API-cost
// resilience win for any OTHER IPFS image that's only failing on one
// specific gateway, which is a common transient IPFS gateway reliability
// pattern, not a Solana/Sui-specific one).
const IPFS_GATEWAYS = ["https://ipfs.io/ipfs/", "https://nftstorage.link/ipfs/", "https://w3s.link/ipfs/", "https://dweb.link/ipfs/"];

// Matches both URL shapes vendors actually return: subdomain form
// (`{cid}.ipfs.{gateway}/path`, e.g. Magic Eden's stats API) and path form
// (`https://{gateway}/ipfs/{cid}/path`, e.g. this app's own Tradeport
// `ipfs://` rewrite in lib/nft/tradeport.ts). Returns null for anything else
// (Walrus aggregator URLs, Shadow Drive, vendor-native APIs, etc.) — those
// have no CID to retry against a different gateway.
function extractIpfsCidAndPath(url: string): { cid: string; path: string } | null {
  const subdomainMatch = url.match(/^https?:\/\/([a-zA-Z0-9]+)\.ipfs\.[^/]+\/?(.*)$/);
  if (subdomainMatch) return { cid: subdomainMatch[1], path: subdomainMatch[2] ?? "" };
  const pathMatch = url.match(/^https?:\/\/[^/]+\/ipfs\/([a-zA-Z0-9]+)\/?(.*)$/);
  if (pathMatch) return { cid: pathMatch[1], path: pathMatch[2] ?? "" };
  return null;
}

/**
 * `fallbackSrc` (added 2026-07-22) — some Tradeport collections' own
 * cover_url points at data that's genuinely gone (a Popkins cover blob on
 * Walrus that's expired/been garbage-collected; a DeSuiLabs cover hosted on
 * a GenesysGo Shadow Drive domain that no longer resolves at all — both
 * confirmed live, not gateway/rewrite bugs). When the primary `src` fails
 * to load, this tries `fallbackSrc` (e.g. a real listed item's own image)
 * before giving up to the broken-image placeholder — real data recovery,
 * not just a nicer error state.
 *
 * IPFS gateway retry chain (added 2026-08-04) — tried BEFORE `fallbackSrc`,
 * since it recovers the actual intended image rather than substituting a
 * different one: if `src` (or `fallbackSrc`) is a recognizable IPFS gateway
 * URL, retries the same CID against `IPFS_GATEWAYS` in order before falling
 * through to `fallbackSrc`/the placeholder.
 */
export function NftImage({
  src,
  fallbackSrc,
  alt,
  className,
}: {
  src: string;
  fallbackSrc?: string;
  alt: string;
  className?: string;
}) {
  const [gatewayAttempt, setGatewayAttempt] = useState(0); // 0 = original src, 1..N = IPFS_GATEWAYS[attempt-1]
  const [triedFallback, setTriedFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const baseSrc = triedFallback ? fallbackSrc : src;
  const ipfsRef = baseSrc ? extractIpfsCidAndPath(baseSrc) : null;
  const effectiveSrc = failed
    ? ""
    : gatewayAttempt > 0 && ipfsRef
      ? `${IPFS_GATEWAYS[gatewayAttempt - 1]}${ipfsRef.cid}/${ipfsRef.path}`
      : baseSrc;

  if (!effectiveSrc) {
    return (
      <div className={`flex items-center justify-center bg-accent-soft ${className ?? ""}`}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="var(--ink-faint)" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" fill="var(--ink-faint)" />
          <path d="M21 15l-5-5-9 9" stroke="var(--ink-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-surface-hover ${className ?? ""}`}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-accent-soft" />}
      {/* Routed through /api/img (2026-08-04) — effectiveSrc is a genuinely
          unbounded third-party host (IPFS gateways, marketplace CDNs), so
          next/image can't point at it directly. `fill` fits here since the
          caller controls actual size entirely via `className` on the parent
          (which is already `relative` + sized above), never a fixed
          width/height passed to this component. */}
      <Image
        src={proxiedImageUrl(effectiveSrc)}
        alt={alt}
        fill
        sizes="(max-width: 640px) 33vw, 220px"
        onError={() => {
          if (ipfsRef && gatewayAttempt < IPFS_GATEWAYS.length) {
            setGatewayAttempt((n) => n + 1);
          } else if (!triedFallback && fallbackSrc) {
            setTriedFallback(true);
            setGatewayAttempt(0); // let the fallback image try its own gateway chain too, if it's also IPFS
          } else {
            setFailed(true);
          }
        }}
        onLoad={() => setLoaded(true)}
        className={`object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
