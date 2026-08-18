"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TokenIcon } from "@/app/components/TokenIcon";
import { TokenSelectModal, type SelectedToken } from "@/app/components/TokenSelectModal";
import { toAtomicAmount } from "@/lib/client/amount";
import { normalizeSolanaSourceMint } from "@/lib/client/constants";
import type { TokenListItem } from "@/lib/chains/types";
import { chainBrandColor } from "@/lib/chainBrandColors";
import { RoutePathVisualizer } from "@/app/components/RoutePathVisualizer";
import { BTC_CHAIN_ID, SUI_CHAIN_ID, btcFlowCurrency } from "@/lib/chains/swapChains";
import { generateFreshSolanaWallet, generateFreshEvmWallet, type FreshWallet } from "@/lib/client/generateFreshWallet";
import { CHANGENOW_ETH_NETWORK_BY_CHAIN_ID } from "@/lib/chains/changenowEvmNetworks";

const SOLANA_CHAIN_ID = 792703809;
const ETHEREUM_CHAIN_ID = 1;

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function TokenPill({ token, onClick }: { token: SelectedToken | null; onClick: () => void }) {
  if (!token) {
    return (
      <button
        onClick={onClick}
        className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.96]"
      >
        Select token <span aria-hidden="true">›</span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded-full border border-hairline bg-surface-hover px-3 py-1.5 transition-all hover:border-accent/40 active:scale-[0.96]"
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
 * 2026-08-07: a non-native Solana token used to be blocked as a Buy target
 * UNCONDITIONALLY — real user report ("select Solana then want to swap to
 * another Solana token, it doesn't display anything"). Root cause: this app's
 * Jupiter integration (lib/chains/jupiter.ts) was hardcoded to only ever
 * quote SPL->SOL (built as leg 1 of a cross-chain bridge, where the
 * destination genuinely always is native SOL), and that hardcoding leaked
 * into this filter. Jupiter's own aggregator has always supported any
 * mint-to-mint pair — getJupiterQuote now accepts an explicit destinationMint,
 * and the same-chain Solana quote/execute paths (app/api/quote/route.ts,
 * app/api/quote/preview/route.ts, app/api/swap/route.ts) were fixed to match.
 * A non-native Solana buy target is now allowed WHEN the sell side is also
 * Solana (same-chain SPL<->SPL, or SOL->SPL) — cross-chain delivery INTO
 * Solana remains native-SOL-only, since Relay only ever bridges SOL onto
 * Solana, not an arbitrary SPL token.
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
// Bitcoin (2026-08-08b): ChangeNOW is the execution engine for any BTC leg
// (see app/api/quote/btc/route.ts), and this app has only ever verified it
// live for BTC<->SOL and BTC<->ETH — never an arbitrary SPL/ERC20 or a
// non-Ethereum EVM chain. Both directions of that constraint live here: a
// BTC buy target is only reachable from a native-SOL or native-Ethereum-ETH
// sell side, and (symmetrically) once BTC is the sell side, only native SOL
// or native Ethereum ETH are valid buy targets.
// Sui (2026-08-18): same ChangeNOW execution engine, same conservative
// constraint — only paired with native SOL/ETH, not with BTC (that combo
// is unverified; ChangeNOW likely supports it, but this app hasn't tested
// it live, same discipline as every other untested pair in this file).
function isNativeSolOrEth(t: { chainId: number; isNative: boolean }): boolean {
  return (t.chainId === SOLANA_CHAIN_ID || t.chainId === ETHEREUM_CHAIN_ID) && t.isNative;
}

export function isBuyTokenAllowed(sellChainId: number | undefined, t: { chainId: number; isNative: boolean }): boolean {
  if (t.chainId === BTC_CHAIN_ID || t.chainId === SUI_CHAIN_ID) {
    if (sellChainId === SOLANA_CHAIN_ID || sellChainId === ETHEREUM_CHAIN_ID) return true;
    // Real gap found live 2026-08-18 (user report, "arbitrum to SUI?"):
    // ChangeNOW supports ETH's native L2 representations landing on Sui
    // (confirmed live, see lib/chains/changenowEvmNetworks.ts) — scoped to
    // a Sui buy target only, per instruction; BTC keeps its original
    // mainnet-ETH-only scope (untested for L2s, no reason yet to widen).
    return t.chainId === SUI_CHAIN_ID && sellChainId != null && sellChainId in CHANGENOW_ETH_NETWORK_BY_CHAIN_ID;
  }
  if (sellChainId === BTC_CHAIN_ID || sellChainId === SUI_CHAIN_ID) {
    return isNativeSolOrEth(t);
  }
  if (t.chainId === SOLANA_CHAIN_ID && !t.isNative) {
    return sellChainId === SOLANA_CHAIN_ID;
  }
  return true;
}

// Symmetric counterpart to isBuyTokenAllowed above, for the OTHER pick
// order: Buy already fixed to BTC/Sui, now choosing Sell. Real gap found
// live 2026-08-18 (user report): there was no such filter at all — the
// Sell modal had zero chain restriction, so e.g. BNB Chain or Polygon
// (neither of which is ETH, a completely different ChangeNOW currency this
// app doesn't support) could be picked as Sell for a BTC/Sui buy target,
// silently mis-quoted as if it were ETH. isBuyTokenAllowed's own
// isNativeSolOrEth check only ever ran in the other pick order and never
// caught this.
export function isSellTokenAllowedForBtcPair(buyChainId: number | undefined, t: { chainId: number; isNative: boolean }): boolean {
  if (buyChainId !== BTC_CHAIN_ID && buyChainId !== SUI_CHAIN_ID) return true; // not a ChangeNOW pair at all — unrestricted
  if (t.chainId === buyChainId) return false; // can't sell what you're buying (BTC/Sui chains each have exactly one token)
  if (t.chainId === BTC_CHAIN_ID || t.chainId === SUI_CHAIN_ID) return true;
  if (t.chainId === SOLANA_CHAIN_ID) return t.isNative; // ChangeNOW only ever handles native SOL, never an SPL token
  if (!t.isNative) return false; // ChangeNOW only ever handles each EVM chain's native ETH, never an ERC20
  if (t.chainId === ETHEREUM_CHAIN_ID) return true;
  // See isBuyTokenAllowed's comment just above — same Sui-only scoping.
  return buyChainId === SUI_CHAIN_ID && t.chainId in CHANGENOW_ETH_NETWORK_BY_CHAIN_ID;
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
  ownDestAddress,
  onUseOwnDestAddress,
  isCrossChain,
  onFlip,
  sellBalance,
  sellBalanceLoading,
  onPreviewChange,
  autoRefuel,
  onAutoRefuelChange,
  mevShield,
  onMevShieldChange,
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
  /** The user's own connected wallet address on the Buy chain's family
   * (Solana or EVM), when they have one connected — null otherwise, in
   * which case no auto-fill/quick-switch UI is shown and the field behaves
   * exactly like a plain manual-paste input (2026-08-07, multi-wallet
   * auto-fill — see SwapPageClient.tsx's ownDestAddress doc). */
  ownDestAddress?: string | null;
  onUseOwnDestAddress?: () => void;
  isCrossChain: boolean;
  onFlip: () => void;
  /** Balance for the current Sell token — Solana or EVM, source chosen by the caller. null hides the balance row/Max button entirely rather than showing a misleading "0" for a chain this doesn't fetch. */
  sellBalance?: number | null;
  sellBalanceLoading?: boolean;
  /** Mirrors this panel's own live quote preview up to the parent — used for the Review modal's rate/minimum-received summary (2026-08-06 swap revamp), which lives outside this component. */
  onPreviewChange?: (preview: {
    destAmountFormatted: string | null;
    destAmountUsd: string | null;
    // Sell-side USD for a BTC/Sui pair (2026-08-18) — set by
    // /api/quote/btc/preview, which is the only preview route that prices
    // the Sell side at all; the Jupiter/Relay preview leaves this unset and
    // SwapPanel falls back to its own client-side native-SOL calc instead.
    sourceAmountUsd?: string | null;
    feeBreakdown?: Array<{ label: string; bps: number; amountUsd: string | null }>;
    route?: Array<{ label: string; engine: "jupiter" | "relay" }>;
    autoRefuelAvailable?: boolean;
    // Set by /api/quote/btc/preview when the typed amount falls outside
    // ChangeNOW's tradeable range for a BTC/Sui pair (2026-08-18, real bug
    // found live: this preview used to silently stay blank with no
    // explanation for a too-small amount instead of saying why).
    error?: string | null;
  } | null) => void;
  /** Just-In-Time Gas toggle (2026-08-07) — controlled from SwapPageClient
   * so the same value reaches both this panel's live preview AND the real
   * POST /api/quote call at execution time. Default off (see
   * lib/chains/relay.ts's getRelayQuote doc — Relay itself no-ops the
   * request for a non-EVM/already-native destination). */
  autoRefuel: boolean;
  onAutoRefuelChange: (v: boolean) => void;
  /** MEV Shield (2026-08-09) — Solana-origin only, controlled from
   * SwapPageClient the same way as autoRefuel above, since it changes
   * which endpoint the leg1 signed transaction is broadcast to at
   * execution time (see lib/client/jito.ts). */
  mevShield: boolean;
  onMevShieldChange: (v: boolean) => void;
}) {
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [preview, setPreview] = useState<{
    destAmountFormatted: string | null;
    destAmountUsd: string | null;
    // Sell-side USD for a BTC/Sui pair (2026-08-18) — set by
    // /api/quote/btc/preview, which is the only preview route that prices
    // the Sell side at all; the Jupiter/Relay preview leaves this unset and
    // SwapPanel falls back to its own client-side native-SOL calc instead.
    sourceAmountUsd?: string | null;
    feeBreakdown?: Array<{ label: string; bps: number; amountUsd: string | null }>;
    route?: Array<{ label: string; engine: "jupiter" | "relay" }>;
    autoRefuelAvailable?: boolean;
    // Set by /api/quote/btc/preview when the typed amount falls outside
    // ChangeNOW's tradeable range for a BTC/Sui pair (2026-08-18, real bug
    // found live: this preview used to silently stay blank with no
    // explanation for a too-small amount instead of saying why).
    error?: string | null;
    routeAudit?: { priceImpactPct: number | null; timeEstimateSeconds: number | null; dexLabels: string[] };
  } | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [freshWallet, setFreshWallet] = useState<FreshWallet | null>(null);
  const [freshWalletSaved, setFreshWalletSaved] = useState(false);
  const [routeAuditOpen, setRouteAuditOpen] = useState(false);
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
  // Symmetric filter for the other pick order — see
  // isSellTokenAllowedForBtcPair's own doc for the real gap this closes
  // (2026-08-18).
  const filterSellTokens = useCallback(
    (t: TokenListItem) =>
      isSellTokenAllowedForBtcPair(buyToken?.chainId, t) &&
      !(buyToken && t.chainId === buyToken.chainId && t.address.toLowerCase() === buyToken.address.toLowerCase()),
    [buyToken],
  );

  const amount = Number(sellAmount);
  const hasValidInput = Boolean(sellToken && buyToken && sellAmount && Number.isFinite(amount) && amount > 0);
  // Name kept as "isBtcPair" (not renamed to something like
  // isChangeNowPair) to minimize diff on a working real-money flow — it now
  // also covers Sui, both routed through the same ChangeNOW-backed
  // /api/quote/btc* endpoints (see lib/chains/swapChains.ts's btcFlowCurrency).
  const isBtcPair =
    sellToken?.chainId === BTC_CHAIN_ID ||
    buyToken?.chainId === BTC_CHAIN_ID ||
    sellToken?.chainId === SUI_CHAIN_ID ||
    buyToken?.chainId === SUI_CHAIN_ID;

  // Sell-side USD value (2026-08-10 UX-audit follow-up, extended
  // 2026-08-18 to EVM) — the Buy side already gets destAmountUsd from the
  // quote preview; this mirrors it for Sell using a per-token price source,
  // branched by chain: Solana via /api/tokens/mint-prices (same
  // Jupiter-backed source Dust Sweeper already uses), EVM via
  // /api/tokens/evm-price (new — mirrors the exact native/ERC20 price
  // sources /api/tokens/balances already established for the
  // wallet-holdings picker). BTC/Sui sell tokens are priced separately, via
  // the quote preview's own sourceAmountUsd (see the isBtcPair branch
  // below) — this effect skips them entirely rather than racing two price
  // sources against each other. Fetched once per token (a price, not
  // per-keystroke), multiplied client-side by the live-typed amount so it
  // updates immediately without a network round-trip on every digit.
  const [sellPriceUsd, setSellPriceUsd] = useState<number | null>(null);
  useEffect(() => {
    if (!sellToken || sellToken.chainId === BTC_CHAIN_ID || sellToken.chainId === SUI_CHAIN_ID) {
      // Deferred via a microtask, not called synchronously in the effect
      // body — see PointsPill.tsx's identical pattern for the reasoning
      // (react-hooks/set-state-in-effect enforced strictly in this repo).
      Promise.resolve().then(() => setSellPriceUsd(null));
      return;
    }
    let cancelled = false;
    const url =
      sellToken.chainId === SOLANA_CHAIN_ID
        ? // Real gap found live 2026-08-18 (user report): native SOL picked
          // from the token modal carries Relay's System Program sentinel
          // address (RELAY_NATIVE_SOL_SENTINEL, see lib/client/constants.ts),
          // not the real wrapped-SOL mint Jupiter's price API expects — this
          // fetch was the one call site in the app that queried mint-prices
          // with the raw token address instead of running it through
          // normalizeSolanaSourceMint first (every other Relay-sentinel
          // consumer already does — see that constant's own doc for the
          // full list). The sentinel has no Jupiter price, so this always
          // resolved to null: Sell-side USD showed $0.00 for every native
          // SOL sell, 100% of the time.
          `/api/tokens/mint-prices?mints=${encodeURIComponent(normalizeSolanaSourceMint(sellToken.address))}`
        : `/api/tokens/evm-price?chainId=${sellToken.chainId}&address=${encodeURIComponent(sellToken.address)}`;
    const priceMint = sellToken.chainId === SOLANA_CHAIN_ID ? normalizeSolanaSourceMint(sellToken.address) : null;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: { prices?: Record<string, number | null>; price?: number | null }) => {
        if (cancelled) return;
        setSellPriceUsd(priceMint ? (d.prices?.[priceMint] ?? null) : (d.price ?? null));
      })
      .catch(() => {
        if (!cancelled) setSellPriceUsd(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sellToken]);
  const sellAmountUsd = sellPriceUsd != null && Number.isFinite(amount) && amount > 0 ? (amount * sellPriceUsd).toFixed(2) : null;

  // Live "how much would I get" preview — public/unauthenticated (see
  // app/api/quote/preview), so it works even before a wallet is connected.
  // Branches to /api/quote/btc/preview for any pair involving Bitcoin —
  // that currency isn't covered by /api/quote/preview's Jupiter/Relay logic
  // (see app/api/quote/btc/route.ts's doc for why BTC is a separate engine).
  useEffect(() => {
    if (!hasValidInput || !sellToken || !buyToken) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const handle = setTimeout(() => {
      setPreviewLoading(true);

      const url = isBtcPair
        ? `/api/quote/btc/preview?${new URLSearchParams({
            sourceCurrency: btcFlowCurrency(sellToken),
            sourceAmount: sellAmount,
            destCurrency: btcFlowCurrency(buyToken),
            // Real gap found live 2026-08-18 (user report, "arbitrum to
            // SUI?") — see SwapPageClient.tsx's identical param on the
            // real quote request for the full explanation. A no-op
            // (server ignores it) unless the Sell token is EVM.
            ...(btcFlowCurrency(sellToken) === "eth" ? { sourceChainId: String(sellToken.chainId) } : {}),
          })}`
        : `/api/quote/preview?${new URLSearchParams({
            sourceChainId: String(sellToken.chainId),
            sourceMint: normalizeSolanaSourceMint(sellToken.address),
            sourceAmount: toAtomicAmount(sellAmount, sellToken.decimals),
            destChainId: String(buyToken.chainId),
            // "SOL" sentinel only for an actual native-SOL pick — real gap fixed
            // 2026-08-07: this used to force "SOL" for ANY Solana buyToken,
            // which meant picking a different SPL token as Buy silently priced
            // native SOL instead. destDecimals lets the preview route format an
            // arbitrary SPL token's raw atomic amount correctly (see that
            // route's own doc — it doesn't have a token registry of its own).
            destToken: buyToken.chainId === SOLANA_CHAIN_ID ? (buyToken.isNative ? "SOL" : buyToken.address) : buyToken.address,
            destDecimals: String(buyToken.decimals),
            autoRefuel: String(autoRefuel),
          })}`;

      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setPreview(d))
        .catch((err) => {
          if (err.name !== "AbortError") setPreview(null);
        })
        .finally(() => setPreviewLoading(false));
    }, 400);

    return () => clearTimeout(handle);
  }, [sellToken, buyToken, sellAmount, hasValidInput, autoRefuel, isBtcPair]);

  // Mirrors `preview` up to the parent whenever it changes — see
  // onPreviewChange's own doc above for why.
  useEffect(() => {
    onPreviewChange?.(hasValidInput ? preview : null);
    // onPreviewChange is a fresh closure every render in the current caller
    // (not memoized) — omitted from deps deliberately, same "depend on the
    // data, not a possibly-unstable callback identity" reasoning already
    // used elsewhere in this file (see the balance-hook deps comment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, hasValidInput]);

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
      {/* focus-within glow (2026-08-06 visual pass) — the amount input itself
          has no border of its own (bg-transparent, outline-none by design),
          so the halo goes on the card that visually contains it instead. */}
      <div className="rounded-2xl border border-hairline bg-surface p-4 shadow-sm transition-shadow focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
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
        {/* Sell-side USD, 2026-08-18: Solana and EVM sell tokens price
            themselves client-side (sellAmountUsd, above, via
            /api/tokens/mint-prices or /api/tokens/evm-price). A BTC/Sui
            sell token has no per-token price endpoint of its own — falls
            back to the quote preview's sourceAmountUsd instead. */}
        {sellToken &&
          (sellToken.chainId === BTC_CHAIN_ID || sellToken.chainId === SUI_CHAIN_ID ? (
            isBtcPair && (
              <p className="num mt-2 text-sm text-ink-faint">
                {hasValidInput && preview?.sourceAmountUsd ? `$${preview.sourceAmountUsd}` : "$0.00"}
              </p>
            )
          ) : (
            <p className="num mt-2 text-sm text-ink-faint">{sellAmountUsd ? `$${sellAmountUsd}` : "$0.00"}</p>
          ))}
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

      {/* Gradient ring encodes the sell→buy chain pair (2026-08-06 visual
          pass) — real per-chain brand colors (lib/chainBrandColors.ts), not
          decorative-only; falls back to the accent color when a chain isn't
          in the registry, so it never renders a wrong/fabricated color. */}
      <div className="relative z-10 flex justify-center" style={{ marginTop: -18, marginBottom: -18 }}>
        <div
          className="rounded-xl p-[1.5px] shadow-sm transition-all"
          style={{
            background: `linear-gradient(135deg, ${chainBrandColor(sellToken?.chainId)}, ${chainBrandColor(buyToken?.chainId)})`,
          }}
        >
          <button
            onClick={onFlip}
            className="group flex h-10 w-10 items-center justify-center rounded-[10px] border border-hairline bg-surface text-ink-muted transition-all hover:text-accent active:scale-90"
            aria-label="Flip sell/buy"
          >
            <span className="inline-block transition-transform duration-200 group-hover:rotate-180">↓</span>
          </button>
        </div>
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
        {hasValidInput && !previewLoading && preview?.error && (
          <p className="mt-2 rounded-xl border border-danger-soft bg-danger-soft px-3 py-2 text-xs text-danger">{preview.error}</p>
        )}

        {/* Route Auditor (2026-08-09) — real fields both Relay and Jupiter
            already return on the quote this panel already fetches
            (totalImpact/timeEstimate/routePlan), previously discarded. No
            synthetic "confidence score" — see lib/chains/routeAudit.ts's
            doc comment for why that would be fabricated precision. */}
        {hasValidInput && preview?.routeAudit && (preview.routeAudit.priceImpactPct !== null || preview.routeAudit.timeEstimateSeconds !== null) && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setRouteAuditOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-ink-faint hover:text-ink-muted"
            >
              🔍 Route details
              <span aria-hidden="true" className={`text-[9px] transition-transform ${routeAuditOpen ? "rotate-180" : ""}`}>
                ▾
              </span>
            </button>
            {routeAuditOpen && (
              <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-hairline bg-surface-hover px-2.5 py-2 text-xs text-ink-muted">
                {preview.routeAudit.priceImpactPct !== null && (
                  <div className="flex justify-between">
                    <span>Price impact</span>
                    <span
                      className={`num ${Math.abs(preview.routeAudit.priceImpactPct) > 1 ? "text-danger" : Math.abs(preview.routeAudit.priceImpactPct) > 0.3 ? "text-amber-500" : "text-ink"}`}
                    >
                      {preview.routeAudit.priceImpactPct > 0 ? "+" : ""}
                      {preview.routeAudit.priceImpactPct.toFixed(3)}%
                    </span>
                  </div>
                )}
                {preview.routeAudit.timeEstimateSeconds !== null && (
                  <div className="flex justify-between">
                    <span>Est. time</span>
                    <span className="num text-ink">~{preview.routeAudit.timeEstimateSeconds}s</span>
                  </div>
                )}
                {preview.routeAudit.dexLabels.length > 0 && (
                  <div className="flex justify-between gap-2">
                    <span>Filled via</span>
                    <span className="text-ink">{preview.routeAudit.dexLabels.join(", ")}</span>
                  </div>
                )}
                <p className="mt-0.5 text-[10px] text-ink-faint">
                  Real data from the route providers — not a synthetic score.
                </p>
              </div>
            )}
          </div>
        )}

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

            {/* Multi-wallet auto-fill (2026-08-07, same idea as Relay's own
                app) — only rendered when the user actually has a wallet
                connected on the Buy chain's family; otherwise this whole
                block is absent and the field is a plain manual-paste input,
                unchanged from before. */}
            {ownDestAddress &&
              (destAddress === ownDestAddress ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
                  <span aria-hidden="true">✓</span> Auto-filled from your connected {buyToken?.chainDisplayName} wallet
                </p>
              ) : (
                <button
                  type="button"
                  onClick={onUseOwnDestAddress}
                  className="mt-1 w-fit text-[11px] font-medium text-accent hover:underline"
                >
                  Use my connected {buyToken?.chainDisplayName} wallet ({shortenAddress(ownDestAddress)}) instead
                </button>
              ))}

            {/* GhostSwap (2026-08-09) — a brand-new, unlinked destination
                wallet generated entirely client-side (see
                lib/client/generateFreshWallet.ts). Delivering to a fresh
                address the payer never controlled before breaks the
                DIRECT on-chain link to the source wallet, since the funds
                arrive from Relay's own solver inventory, not a traceable
                transfer between the two addresses — it does not make the
                transaction untraceable outright (timing/amount
                correlation can still connect them), so the copy below is
                deliberately worded that way. */}
            {buyToken && !freshWallet && (
              <button
                type="button"
                onClick={() => {
                  const wallet = buyToken.chainId === SOLANA_CHAIN_ID ? generateFreshSolanaWallet() : generateFreshEvmWallet();
                  setFreshWallet(wallet);
                  setFreshWalletSaved(false);
                }}
                className="mt-1 w-fit text-[11px] font-medium text-accent hover:underline"
              >
                👻 Generate a fresh, unlinked wallet instead
              </button>
            )}
            {freshWallet && (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-hairline bg-surface-hover p-2.5 text-[11px]">
                <p className="text-ink-muted">
                  New address — breaks the direct on-chain link to your source wallet. This is not shown again; save the private
                  key now or you&apos;ll lose access to it.
                </p>
                <div className="flex flex-col gap-1">
                  <span className="text-ink-faint">Address</span>
                  <span className="num break-all text-ink">{freshWallet.address}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-ink-faint">Private key — save this now, never shared with this app</span>
                  <span className="num break-all text-danger">{freshWallet.privateKey}</span>
                </div>
                <label className="flex items-center gap-1.5 text-ink-muted">
                  <input type="checkbox" checked={freshWalletSaved} onChange={(e) => setFreshWalletSaved(e.target.checked)} />
                  I&apos;ve saved the private key somewhere safe
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!freshWalletSaved}
                    onClick={() => {
                      onDestAddressChange(freshWallet.address);
                      setFreshWallet(null);
                    }}
                    className="rounded-lg bg-accent px-2 py-1 font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Use this address
                  </button>
                  <button
                    type="button"
                    onClick={() => setFreshWallet(null)}
                    className="rounded-lg border border-hairline px-2 py-1 font-medium text-ink-muted"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Just-In-Time Gas toggle (2026-08-07) — only shown once the live
            preview confirms Relay's topupGas actually applies to this
            destination (EVM only — see getRelayQuote's doc). Default off; a
            real opt-in, not an auto-enabled-below-a-threshold heuristic,
            since probing an arbitrary destination address's balance on an
            arbitrary EVM chain isn't a capability this app has. */}
        {hasValidInput && preview?.autoRefuelAvailable && (
          <label className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3 text-xs text-ink-muted">
            <span>Add ~$2 destination gas so you can use your new tokens immediately</span>
            <input
              type="checkbox"
              checked={autoRefuel}
              onChange={(e) => onAutoRefuelChange(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
          </label>
        )}

        {/* MEV Shield (2026-08-09, Solana-only) — only shown for a
            Solana-origin sell token, since Jito's private relay is a
            Solana-specific mechanism (see lib/client/jito.ts's doc for why
            the EVM/Flashbots side isn't offered — standard injected
            wallets don't expose the raw-signed-tx capability it needs). */}
        {hasValidInput && sellToken?.chainId === SOLANA_CHAIN_ID && (
          <label className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3 text-xs text-ink-muted">
            <span>🛡️ Route via Jito — avoid public mempool (MEV protection)</span>
            <input
              type="checkbox"
              checked={mevShield}
              onChange={(e) => onMevShieldChange(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
          </label>
        )}
      </div>

      {hasValidInput && preview?.route && preview.route.length > 0 && sellToken && buyToken && (
        <RoutePathVisualizer sellChainId={sellToken.chainId} buyChainId={buyToken.chainId} route={preview.route} />
      )}

      <TokenSelectModal
        open={sellModalOpen}
        onClose={() => setSellModalOpen(false)}
        mode="multi-chain"
        onSelect={onSellTokenChange}
        filterTokens={filterSellTokens}
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
