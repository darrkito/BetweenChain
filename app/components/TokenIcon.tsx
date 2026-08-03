"use client";

import { useState } from "react";

const PALETTE = ["#4B3AF0", "#7C6BFB", "#2FB6A3", "#F0824B", "#E0568C", "#3A8DE0"];

function colorForSymbol(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function Circle({
  src,
  fallbackLetter,
  size,
  className,
}: {
  src: string;
  fallbackLetter: string;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-full text-white font-semibold ${className ?? ""}`}
        style={{ width: size, height: size, backgroundColor: colorForSymbol(fallbackLetter), fontSize: size * 0.45 }}
      >
        {fallbackLetter.charAt(0).toUpperCase() || "?"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, unbounded set of token/chain logo hosts
    <img
      src={src}
      alt={fallbackLetter}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`rounded-full object-cover ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}

export function TokenIcon({
  logoURI,
  symbol,
  chainIconUrl,
  size = 36,
}: {
  logoURI: string;
  symbol: string;
  chainIconUrl?: string | null;
  size?: number;
}) {
  const badgeSize = Math.round(size * 0.45);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Circle src={logoURI} fallbackLetter={symbol} size={size} />
      {chainIconUrl !== undefined && chainIconUrl !== null && (
        <div
          className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white"
          style={{ width: badgeSize, height: badgeSize }}
        >
          <Circle src={chainIconUrl} fallbackLetter={symbol} size={badgeSize} />
        </div>
      )}
    </div>
  );
}
