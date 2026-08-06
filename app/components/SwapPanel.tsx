"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TokenIcon } from "@/app/components/TokenIcon";
import { TokenSelectModal, type SelectedToken } from "@/app/components/TokenSelectModal";
import { toAtomicAmount } from "@/lib/client/amount";
import { normalizeSolanaSourceMint } from "@/lib/client/constants";
import type { TokenListItem } from "@/lib/chains/types";

const SOLANA_CHAIN_ID = 792703809;

function TokenPill({ token, onClick }: { token: SelectedToken | null; onClick: () => void }) {
  if (!token) {
    return (
      <button
        onClick={onClick}
        className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:brightness-110"
      >
        Select token <span aria-hidden="true">›</span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded-full border border-hairline bg-surface-hover px-3 py-1.5 transition-colors hover:border-accent/40"
    >
      <TokenIcon logoURI={token.logoURI} symbol={token.symbol} chainIconUrl={token.chainIconUrl} size={32} />
      <span className="text-left">
        <span className="block text-sm font-semibold leading-tight text-ink">{token.symbol}</span>
        <span className="block text-xs leading-tight text-ink-faint">{token.chainDisplayName}</span>
      </span>
      <span className="text-ink-faint" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/**
 * Whether a token is a valid Buy-side pick given the current Sell-side
 * chain. Enforced here so page.tsx's flip() can reuse the exact same check
 * rather than duplicating the logic.
 *
 * Execution only ever produces native SOL for a same-chain (Solana) leg
 * (see AGENTS.md) — a non-native Solana token can never be a Buy target.
 *
 * 2026-08-06: same-chain EVM-to-EVM (e.g. USDC→ETH both on Arbitrum) used to
 * be blocked here too, on the theory that it was "untested against Relay's
 * same-chain routing." Confirmed live it isn't — Relay's /quote returns a
 * real, valid single-step "swap" for originChainId === destinationChainId,
 * using the same /intents/status settlement mechanism as a real cross-chain
 * bridge. Real user report: this filter was producing an empty, unexplained
 * Buy-token list for anyone trying to swap within a single EVM chain. Now
 * enabled — see app/swap/SwapPageClient.tsx's needsRelayLeg2 for the
 * execution side.
 */
export function isBuyTokenAllowed(sellChainId: number | undefined, t: { chainId: number; isNative: boolean }): boolean {
  return !(t.chainId === SOLANA_CHAIN_ID && !t.isNative);
}

export function SwapPanel({
  sellToken,
  buyToken,
  onSellTokenChange,
  onBuyTokenChange,
  sellAmount,
  onSellAmountChange,
  destAddress,
  onDestAddressChange,
  destAddressError,
  isCrossChain,
  onFlip,
  sellBalance,
  sellBalanceLoading,
}: {
  sellToken: SelectedToken | null;
  buyToken: SelectedToken | null;
  onSellTokenChange: (t: SelectedToken) => void;
  onBuyTokenChange: (t: SelectedToken) => void;
  sellAmount: string;
  onSellAmountChange: (v: string) => void;
  destAddress: string;
  onDestAddressChange: (v: string) => void;
  /** Real-time validation message for the cross-chain destination address field, or null when it's empty/valid. */
  destAddressError?: string | null;
  isCrossChain: boolean;
  onFlip: () => void;
  /** Solana-only for now (see lib/client/useSolanaBalance.ts) — null hides the balance row/Max button entirely rather than showing a misleading "0" for a chain this doesn't fetch. */
  sellBalance?: number | null;
  sellBalanceLoading?: boolean;
}) {
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [preview, setPreview] = useState<{ destAmountFormatted: string | null; destAmountUsd: string | null } | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Same-token exclusion (2026-08-06, added alongside enabling same-chain
  // EVM buys): picking the exact same token as both Sell and Buy is a
  // meaningless no-op that would still generate a real Relay quote and burn
  // real gas — worth filtering out client-side rather than letting someone
  // accidentally "swap" ETH for ETH. Address compared case-insensitively —
  // EVM addresses aren't guaranteed consistent casing across sources.
  const filterBuyTokens = useCallback(
    (t: TokenListItem) =>
      isBuyTokenAllowed(sellToken?.chainId, t) &&
      !(sellToken && t.chainId === sellToken.chainId && t.address.toLowerCase() === sellToken.address.toLowerCase()),
    [sellToken],
  );

  const amount = Number(sellAmount);
  const hasValidInput = Boolean(sellToken && buyToken && sellAmount && Number.isFinite(amount) && amount > 0);

  // Live "how much would I get" preview — public/unauthenticated (see
  // app/api/quote/preview), so it works even before a wallet is connected.
  useEffect(() => {
    if (!hasValidInput || !sellToken || !buyToken) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const handle = setTimeout(() => {
      setPreviewLoading(true);
      const params = new URLSearchParams({
        sourceChainId: String(sellToken.chainId),
        sourceMint: normalizeSolanaSourceMint(sellToken.address),
        sourceAmount: toAtomicAmount(sellAmount, sellToken.decimals),
        destChainId: String(buyToken.chainId),
        destToken: buyToken.chainId === SOLANA_CHAIN_ID ? "SOL" : buyToken.address,
      });

      fetch(`/api/quote/preview?${params}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setPreview(d))
        .catch((err) => {
          if (err.name !== "AbortError") setPreview(null);
        })
        .finally(() => setPreviewLoading(false));
    }, 400);

    return () => clearTimeout(handle);
  }, [sellToken, buyToken, sellAmount, hasValidInput]);

  // Native SOL keeps a small reserve out of "Max" for network fees — an
  // exact-balance sell would otherwise leave nothing to pay gas with,
  // guaranteeing the transaction itself fails. SPL tokens need no reserve
  // (fees are always paid in SOL separately, not the token being sold).
  const SOL_FEE_RESERVE = 0.01;
  function handleMax() {
    if (sellBalance == null || !sellToken) return;
    const usable = Math.max(0, sellBalance - (sellToken.isNative ? SOL_FEE_RESERVE : 0));
    onSellAmountChange(usable.toString());
  }

  return (
    <div className="flex flex-col">
      <div className="rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
        <p className="mb-2 text-sm text-ink-faint">Sell</p>
        <div className="flex items-center justify-between gap-2">
          <input
            className="num w-1/2 min-w-0 bg-transparent text-3xl font-semibold text-ink outline-none placeholder:text-ink-faint"
            placeholder="0"
            inputMode="decimal"
            value={sellAmount}
            onChange={(e) => onSellAmountChange(e.target.value)}
          />
          <TokenPill token={sellToken} onClick={() => setSellModalOpen(true)} />
        </div>
        {/* Real gap fixed 2026-08-03: no balance shown for the Sell token at
            all before this, and no "Max" shortcut — Solana-only for now,
            see the sellBalance prop's doc comment above. */}
        {sellBalance != null && (
          <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-ink-faint">
            <span className="num">{sellBalanceLoading ? "…" : `Balance: ${sellBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}`}</span>
            <button onClick={handleMax} className="font-semibold text-accent transition-opacity hover:opacity-80">
              Max
            </button>
          </div>
        )}
      </div>

      <div className="relative z-10 flex justify-center" style={{ marginTop: -18, marginBottom: -18 }}>
        <button
          onClick={onFlip}
          className="group flex h-9 w-9 items-center justify-center rounded-xl border border-hairline bg-surface text-ink-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent"
          aria-label="Flip sell/buy"
        >
          <span className="inline-block transition-transform duration-200 group-hover:rotate-180">↓</span>
        </button>
      </div>

      <div className="rounded-2xl border border-hairline bg-surface p-4 pt-6 shadow-sm">
        <p className="mb-2 text-sm text-ink-faint">Buy</p>
        <div className="flex items-center justify-between gap-2">
          <input
            className="num w-1/2 min-w-0 bg-transparent text-3xl font-semibold text-ink-muted outline-none placeholder:text-ink-faint"
            placeholder="0"
            value={hasValidInput ? (previewLoading ? "…" : (preview?.destAmountFormatted ?? "")) : ""}
            readOnly
          />
          <TokenPill token={buyToken} onClick={() => setBuyModalOpen(true)} />
        </div>
        <p className="num mt-2 text-sm text-ink-faint">
          {hasValidInput && preview?.destAmountUsd ? `$${preview.destAmountUsd}` : "$0.00"}
        </p>

        {isCrossChain && (
          <div className="mt-3 border-t border-hairline pt-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Destination address on {buyToken?.chainDisplayName}
              <input
                className={`num rounded-lg border bg-surface px-2 py-1.5 text-sm text-ink outline-none transition-colors ${
                  destAddressError ? "border-danger" : "border-hairline focus:border-accent"
                }`}
                placeholder="0x…"
                value={destAddress}
                onChange={(e) => onDestAddressChange(e.target.value)}
              />
              {/* Real gap fixed 2026-08-03: a bad destination address
                  previously only surfaced as a generic error after clicking
                  Swap and starting the flow — now flagged inline, before
                  the user commits to anything. */}
              {destAddressError && <span className="text-[11px] text-danger">{destAddressError}</span>}
            </label>
          </div>
        )}
      </div>

      <TokenSelectModal
        open={sellModalOpen}
        onClose={() => setSellModalOpen(false)}
        mode="multi-chain"
        onSelect={onSellTokenChange}
      />
      <TokenSelectModal
        open={buyModalOpen}
        onClose={() => setBuyModalOpen(false)}
        mode="multi-chain"
        onSelect={onBuyTokenChange}
        filterTokens={filterBuyTokens}
      />
    </div>
  );
}

export { SOLANA_CHAIN_ID };
