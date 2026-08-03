"use client";

import { useState } from "react";

/**
 * `fallbackSrc` (added 2026-07-22) — some Tradeport collections' own
 * cover_url points at data that's genuinely gone (a Popkins cover blob on
 * Walrus that's expired/been garbage-collected; a DeSuiLabs cover hosted on
 * a GenesysGo Shadow Drive domain that no longer resolves at all — both
 * confirmed live, not gateway/rewrite bugs). When the primary `src` fails
 * to load, this tries `fallbackSrc` (e.g. a real listed item's own image)
 * before giving up to the broken-image placeholder — real data recovery,
 * not just a nicer error state.
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
  const [triedFallback, setTriedFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const effectiveSrc = failed ? "" : triedFallback ? fallbackSrc : src;

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
      {/* eslint-disable-next-line @next/next/no-img-element -- external, unbounded set of NFT media hosts (IPFS gateways, marketplace CDNs) */}
      <img
        src={effectiveSrc}
        alt={alt}
        onError={() => {
          if (!triedFallback && fallbackSrc) {
            setTriedFallback(true);
          } else {
            setFailed(true);
          }
        }}
        onLoad={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
