"use client";

import type { SelectedToken } from "@/app/components/TokenSelectModal";

/**
 * Fetches the native token for a given chain via /api/tokens/list, shaped
 * as a SelectedToken. Extracted from QuotePreviewWidget.tsx's original
 * Solana-only inline fetch (2026-08-07) so both the widget (now generalized
 * to any chain via initialSellChainId/initialBuyChainId) and
 * SwapPageClient's ?sell=&buy= prefill can share one implementation instead
 * of two copies drifting apart.
 */
export async function fetchNativeToken(chainId: number, chainDisplayName: string): Promise<SelectedToken | null> {
  try {
    const res = await fetch(`/api/tokens/list?chainId=${chainId}`);
    const body: { tokens?: Array<{ address: string; symbol: string; name: string; decimals: number; logoURI: string; isNative: boolean }> } =
      await res.json();
    const native = (body.tokens ?? []).find((t) => t.isNative);
    if (!native) return null;
    return {
      chainId,
      address: native.address,
      symbol: native.symbol,
      name: native.name,
      decimals: native.decimals,
      logoURI: native.logoURI,
      chainDisplayName,
      chainIconUrl: null,
      isNative: true,
    };
  } catch {
    return null;
  }
}
