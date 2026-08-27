"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { SOLANA_CHAIN_ID_CLIENT, normalizeSolanaSourceMint } from "@/lib/client/constants";
import { toAtomicAmount } from "@/lib/client/amount";
import type { SelectedToken } from "@/app/components/TokenSelectModal";
import { TokenIcon } from "@/app/components/TokenIcon";
import { isBuyTokenAllowed, isSellTokenAllowedForBtcPair } from "@/lib/chains/tokenAllowlist";
import { RoutePathVisualizer } from "@/app/components/RoutePathVisualizer";
import { fetchNativeToken } from "@/lib/client/nativeToken";
import { slugForSwapChainId, labelForSwapChainId, BTC_CHAIN_ID, SUI_CHAIN_ID, btcFlowCurrency } from "@/lib/chains/swapChains";

const DEBOUNCE_MS = 500;

// Loaded on demand, not at module scope (2026-08-27, PSI: ~296KB unused JS on
// the homepage). This widget is deliberately "try before you connect a
// wallet" — see the comment below — but TokenSelectModal itself always calls
// useWallet() internally (shared with the real /swap page, which does need
// it), so a static import here pulled the whole @solana/wallet-adapter-react
// + @solana/web3.js + sats-connect stack into the homepage bundle on first
// paint, even though nothing on this page ever connects a wallet. Deferring
// the import AND not mounting the component until the user actually opens a
// picker (see `everOpenedPicker` below) means that code only loads on real
// intent to pick a token, not just from having this widget on the page.
const TokenSelectModal = dynamic(
  () => import("@/app/components/TokenSelectModal").then((m) => m.TokenSelectModal),
  { ssr: false },
);

/**
 * `/swap` when either side isn't picked yet, `/swap?sell=<slug>&buy=<slug>`
 * once both are — reads from the CURRENT selection (which the user may have
 * changed from whatever initialSellChainId/initialBuyChainId seeded), so
 * this benefits every use of this widget, not just the pair landing pages.
 * SwapPageClient.tsx reads these same two params on mount (2026-08-07).
 */
function swapHref(sellToken: SelectedToken | null, buyToken: SelectedToken | null): string {
  if (!sellToken || !buyToken) return "/swap";
  // slugForSwapChainId (not swapChainForChainId directly) so BTC/Sui — the
  // new swap-pair landing pages this widget now supports (2026-08-18) —
  // still resolve to a real slug despite being deliberately excluded from
  // SWAP_CHAINS itself.
  const sellSlug = slugForSwapChainId(sellToken.chainId);
  const buySlug = slugForSwapChainId(buyToken.chainId);
  if (!sellSlug || !buySlug) return "/swap";
  return `/swap?sell=${sellSlug}&buy=${buySlug}`;
}

/**
 * Landing-page "try before you connect a wallet" widget — real user
 * decision, confirmed with the user: compact quote-preview only (no wallet
 * connect, no execution), reusing the existing public/unauthenticated
 * `/api/quote/preview` endpoint (built earlier this session) rather than
 * embedding the full SwapPanel. Both Sell and Buy are now fully pickable
 * (2026-08-05 follow-up) — mirrors app/swap/SwapPageClient.tsx's own
 * sourceMint/destToken param-building and isBuyTokenAllowed filtering, just
 * without a wallet-connected execution step. Sell defaults to native SOL
 * when no `initialSellChainId` is given.
 *
 * `initialSellChainId`/`initialBuyChainId` (2026-08-07, swap-pair landing
 * pages) are optional — omitted (as on the homepage), behavior is unchanged
 * from before this prop existed. When given, both sides seed to that
 * chain's native token via the shared fetchNativeToken helper (previously
 * this component had its OWN inline Solana-only fetch; Buy had no default
 * fetch at all — both are now unified through one helper used by both
 * sides, see lib/client/nativeToken.ts).
 */
export function QuotePreviewWidget({
  initialSellChainId,
  initialBuyChainId,
}: {
  initialSellChainId?: number;
  initialBuyChainId?: number;
} = {}) {
  const [amount, setAmount] = useState("1");
  const [sellToken, setSellToken] = useState<SelectedToken | null>(null);
  const [buyToken, setBuyToken] = useState<SelectedToken | null>(null);
  const [sellPickerOpen, setSellPickerOpen] = useState(false);
  const [buyPickerOpen, setBuyPickerOpen] = useState(false);
  // Gates actually mounting TokenSelectModal at all — see the dynamic()
  // comment above. Once true it stays true (closing a picker shouldn't
  // re-trigger the lazy-load on next open).
  const [everOpenedPicker, setEverOpenedPicker] = useState(false);
  const [result, setResult] = useState<{
    destAmountFormatted: string | null;
    destAmountUsd: string | null;
    route: Array<{ label: string; engine: "jupiter" | "relay" }>;
    error?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sellChainId = initialSellChainId ?? SOLANA_CHAIN_ID_CLIENT;
    const label = sellChainId === SOLANA_CHAIN_ID_CLIENT ? "Solana" : labelForSwapChainId(sellChainId);
    let ignore = false;
    fetchNativeToken(sellChainId, label).then((token) => {
      if (!ignore && token) setSellToken(token);
    });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialBuyChainId === undefined) return;
    let ignore = false;
    fetchNativeToken(initialBuyChainId, labelForSwapChainId(initialBuyChainId)).then((token) => {
      if (!ignore && token) setBuyToken(token);
    });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const parsedAmount = Number(amount);
    if (!sellToken || !buyToken || !amount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Promise.resolve().then(() => setResult(null));
      return;
    }
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) setLoading(true);
    });
    // BTC/Sui pairs (2026-08-18, swap-pair landing pages) run through
    // ChangeNOW's own preview route instead of Jupiter/Relay's — same
    // isBtcPair split SwapPanel.tsx's own live preview already uses. A
    // plain decimal sourceAmount (not atomic units) and currency tickers
    // instead of chain ids/mint addresses — a completely different param
    // shape, not just a different URL.
    const isBtcPair =
      sellToken.chainId === BTC_CHAIN_ID ||
      buyToken.chainId === BTC_CHAIN_ID ||
      sellToken.chainId === SUI_CHAIN_ID ||
      buyToken.chainId === SUI_CHAIN_ID;
    const url = isBtcPair
      ? `/api/quote/btc/preview?${new URLSearchParams({
          sourceCurrency: btcFlowCurrency(sellToken),
          sourceAmount: amount,
          destCurrency: btcFlowCurrency(buyToken),
          ...(btcFlowCurrency(sellToken) === "eth" ? { sourceChainId: String(sellToken.chainId) } : {}),
        })}`
      : `/api/quote/preview?${new URLSearchParams({
          sourceChainId: String(sellToken.chainId),
          sourceMint: normalizeSolanaSourceMint(sellToken.address),
          sourceAmount: toAtomicAmount(amount, sellToken.decimals),
          destChainId: String(buyToken.chainId),
          destToken: buyToken.chainId === SOLANA_CHAIN_ID_CLIENT ? "SOL" : buyToken.address,
        })}`;
    const timer = setTimeout(() => {
      fetch(url)
        .then((r) => r.json())
        .then(
          (body: {
            destAmountFormatted?: string | null;
            destAmountUsd?: string | null;
            route?: Array<{ label: string; engine: "jupiter" | "relay" }>;
            // Set by /api/quote/btc/preview when the typed amount falls
            // outside ChangeNOW's tradeable range — same field SwapPanel.tsx
            // already surfaces, reused here rather than silently showing
            // "no quote" for the exact same real bug fixed there.
            error?: string | null;
          }) => {
            if (!ignore)
              setResult({
                destAmountFormatted: body.destAmountFormatted ?? null,
                destAmountUsd: body.destAmountUsd ?? null,
                route: body.route ?? [],
                error: body.error ?? null,
              });
          },
        )
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
  }, [amount, sellToken, buyToken]);

  // 2026-08-06 (frontend audit, Impeccable detector: "nested-cards") — the
  // three inner rows below used to carry their own `border border-hairline`
  // on top of this outer card's border, a literal card-in-card. Removed the
  // inner borders; `bg-surface-hover` alone is enough to read as a distinct
  // row inside the one outer card.
  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between rounded-xl bg-surface-hover px-3 py-2.5">
        <span className="text-xs font-medium text-ink-faint">Sell</span>
        <div className="flex items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="num w-20 bg-transparent text-right text-sm font-semibold text-ink outline-none"
          />
          <button
            onClick={() => {
              setEverOpenedPicker(true);
              setSellPickerOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2 py-1 transition-colors hover:border-accent/40"
          >
            {sellToken ? (
              <>
                <TokenIcon logoURI={sellToken.logoURI} symbol={sellToken.symbol} chainIconUrl={sellToken.chainIconUrl} size={18} />
                <span className="text-sm font-semibold text-ink">{sellToken.symbol}</span>
              </>
            ) : (
              <span className="text-sm font-medium text-accent">Pick a token</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex justify-center text-ink-faint" aria-hidden="true">
        ↓
      </div>

      <button
        onClick={() => {
          setEverOpenedPicker(true);
          setBuyPickerOpen(true);
        }}
        className="flex items-center justify-between rounded-xl bg-surface-hover px-3 py-2.5 text-left transition-colors hover:bg-accent-soft"
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

      <div className="min-h-[52px] rounded-xl bg-surface-hover px-3 py-2.5">
        {!sellToken || !buyToken ? (
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
        ) : result?.error ? (
          <p className="text-xs text-danger">{result.error}</p>
        ) : (
          <p className="text-xs text-ink-faint">Enter an amount to see an estimate.</p>
        )}
      </div>

      {/* 2026-08-12 — RoutePathVisualizer already existed for SwapPanel.tsx
          (the real /swap flow) but was never wired into this wallet-free
          preview widget, even though this route's own API response
          (/api/quote/preview) already returns the same `route` field.
          Real trust signal, not a new component. */}
      {sellToken && buyToken && result?.route && result.route.length > 0 && (
        <RoutePathVisualizer sellChainId={sellToken.chainId} buyChainId={buyToken.chainId} route={result.route} />
      )}

      <Link
        href={swapHref(sellToken, buyToken)}
        className="rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-ink transition-all hover:brightness-110"
      >
        Swap now →
      </Link>

      {everOpenedPicker && (
        <>
          <TokenSelectModal
            open={sellPickerOpen}
            onClose={() => setSellPickerOpen(false)}
            mode="multi-chain"
            onSelect={setSellToken}
            filterTokens={(t) => isSellTokenAllowedForBtcPair(buyToken?.chainId, t)}
          />
          <TokenSelectModal
            open={buyPickerOpen}
            onClose={() => setBuyPickerOpen(false)}
            mode="multi-chain"
            filterTokens={(t) => isBuyTokenAllowed(sellToken?.chainId, t)}
            onSelect={setBuyToken}
          />
        </>
      )}
    </div>
  );
}
