"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SOLANA_CHAIN_ID_CLIENT, WRAPPED_SOL_MINT } from "@/lib/client/constants";
import { toAtomicAmount } from "@/lib/client/amount";
import { TokenSelectModal, type SelectedToken } from "@/app/components/TokenSelectModal";
import { TokenIcon } from "@/app/components/TokenIcon";

const SOL_DECIMALS = 9;
const DEBOUNCE_MS = 500;

/**
 * Landing-page "try before you connect a wallet" widget — real user
 * decision, confirmed with the user: compact quote-preview only (no wallet
 * connect, no execution), reusing the existing public/unauthenticated
 * `/api/quote/preview` endpoint (built earlier this session) rather than
 * embedding the full SwapPanel. Sell side is fixed to native SOL, matching
 * the real swap page's own default (see app/swap/SwapPageClient.tsx) — a
 * user who wants to sell something else is exactly the "click through to
 * /swap" case this widget intentionally defers to.
 */
export function QuotePreviewWidget() {
  const [amount, setAmount] = useState("1");
  const [buyToken, setBuyToken] = useState<SelectedToken | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [result, setResult] = useState<{ destAmountFormatted: string | null; destAmountUsd: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const parsedAmount = Number(amount);
    if (!buyToken || !amount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Promise.resolve().then(() => setResult(null));
      return;
    }
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) setLoading(true);
    });
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        sourceChainId: String(SOLANA_CHAIN_ID_CLIENT),
        sourceMint: WRAPPED_SOL_MINT,
        sourceAmount: toAtomicAmount(amount, SOL_DECIMALS),
        destChainId: String(buyToken.chainId),
        destToken: buyToken.address,
      });
      fetch(`/api/quote/preview?${params.toString()}`)
        .then((r) => r.json())
        .then((body: { destAmountFormatted?: string | null; destAmountUsd?: string | null }) => {
          if (!ignore) setResult({ destAmountFormatted: body.destAmountFormatted ?? null, destAmountUsd: body.destAmountUsd ?? null });
        })
        .catch(() => {
          if (!ignore) setResult(null);
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [amount, buyToken]);

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between rounded-xl border border-hairline bg-surface-hover px-3 py-2.5">
        <span className="text-xs font-medium text-ink-faint">Sell</span>
        <div className="flex items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="num w-20 bg-transparent text-right text-sm font-semibold text-ink outline-none"
          />
          <span className="text-sm font-semibold text-ink">SOL</span>
        </div>
      </div>

      <div className="flex justify-center text-ink-faint" aria-hidden="true">
        ↓
      </div>

      <button
        onClick={() => setPickerOpen(true)}
        className="flex items-center justify-between rounded-xl border border-hairline bg-surface-hover px-3 py-2.5 text-left transition-colors hover:bg-accent-soft"
      >
        <span className="text-xs font-medium text-ink-faint">Buy</span>
        {buyToken ? (
          <span className="flex items-center gap-2">
            <TokenIcon logoURI={buyToken.logoURI} symbol={buyToken.symbol} chainIconUrl={buyToken.chainIconUrl} size={20} />
            <span className="text-sm font-semibold text-ink">{buyToken.symbol}</span>
          </span>
        ) : (
          <span className="text-sm font-medium text-accent">Pick a token</span>
        )}
      </button>

      <div className="min-h-[52px] rounded-xl border border-hairline bg-surface-hover px-3 py-2.5">
        {!buyToken ? (
          <p className="text-xs text-ink-faint">Pick a destination token to see an estimate.</p>
        ) : loading ? (
          <p className="text-xs text-ink-faint">Getting a quote…</p>
        ) : result?.destAmountFormatted ? (
          <>
            <span className="num text-sm font-semibold text-ink">
              {Number(result.destAmountFormatted).toFixed(6)} {buyToken.symbol}
            </span>
            {result.destAmountUsd && <span className="ml-1.5 text-xs text-ink-faint">(≈${result.destAmountUsd})</span>}
          </>
        ) : (
          <p className="text-xs text-ink-faint">Enter an amount to see an estimate.</p>
        )}
      </div>

      <Link
        href="/swap"
        className="rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-ink transition-all hover:brightness-110"
      >
        Swap now →
      </Link>

      <TokenSelectModal open={pickerOpen} onClose={() => setPickerOpen(false)} mode="multi-chain" onSelect={setBuyToken} />
    </div>
  );
}
