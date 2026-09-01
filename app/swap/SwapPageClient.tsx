"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useSuiWallet } from "@/lib/client/SuiWalletProvider";
import { buildSuiTransferTransaction } from "@/lib/client/suiTransfer";
import { SOLANA_CHAIN_ID_CLIENT, normalizeSolanaSourceMint } from "@/lib/client/constants";
import { toAtomicAmount } from "@/lib/client/amount";
import { buildRelayDepositTransaction } from "@/lib/client/relayTransaction";
import { sendViaJito } from "@/lib/client/jito";
import { simulateSwapTransaction } from "@/lib/client/simulateSolanaTx";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useBtcWallet } from "@/lib/client/BtcWalletProvider";
import { useSolanaBalance } from "@/lib/client/useSolanaBalance";
import { useEvmTokenBalance } from "@/lib/client/useEvmTokenBalance";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { isPlausibleEvmAddress, isPlausibleBtcAddress, isPlausibleSuiAddress } from "@/lib/validation";
import { resolveChangeNowFromNetwork } from "@/lib/chains/changenowEvmNetworks";
import { AppHeader } from "@/app/components/AppHeader";
import { TrendingBar } from "@/app/components/TrendingBar";
import { SwapPanel, isBuyTokenAllowed } from "@/app/components/SwapPanel";
import { SlippageControl } from "@/app/components/SlippageControl";
import { TrustBar } from "@/app/components/TrustBar";
import { PointsSummaryCard } from "@/app/components/PointsSummaryCard";
import { SwapSuccessRewards } from "@/app/components/SwapSuccessRewards";
import type { SwapStep } from "@/app/components/SwapStepper";
import { SwapProgressDrawer } from "@/app/components/SwapProgressDrawer";
import type { SelectedToken } from "@/app/components/TokenSelectModal";
import { useRecentPairs } from "@/lib/client/useRecentPairs";
import { useSavedAddresses } from "@/lib/client/useSavedAddresses";
import { useSessionActivity } from "@/lib/client/useSessionActivity";
import { fetchNativeToken } from "@/lib/client/nativeToken";
import { resolveSwapChainSlug, BTC_CHAIN_ID, SUI_CHAIN_ID, btcFlowCurrency } from "@/lib/chains/swapChains";
import { MORE_TOOLS } from "@/lib/content/moreTools";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Step = "idle" | "quoting" | "leg1_signing" | "leg1_confirming" | "leg2_pending" | "done" | "error";

function isValidDestAddress(address: string, chainId: number): boolean {
  if (!address) return false;
  if (chainId === SOLANA_CHAIN_ID_CLIENT) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
  if (chainId === BTC_CHAIN_ID) return isPlausibleBtcAddress(address);
  if (chainId === SUI_CHAIN_ID) return isPlausibleSuiAddress(address);
  return isPlausibleEvmAddress(address);
}


export function SwapPageClient() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const connectWalletModal = useConnectWalletModal();
  const searchParams = useSearchParams();

  const [sellToken, setSellToken] = useState<SelectedToken | null>(null);
  const [buyToken, setBuyToken] = useState<SelectedToken | null>(null);
  const [sellAmount, setSellAmount] = useState("");
  // Real gap found live 2026-08-18 (user report): "SOL->SUI only quotes at
  // 1 and above" — a comma decimal separator (what many non-US mobile
  // keyboards produce for inputMode="decimal", e.g. "0,5") makes
  // Number(sellAmount) silently NaN, so hasValidInput in SwapPanel goes
  // false and the preview effect never fires — no error, it just looks
  // like nothing happens for any non-whole amount. Whole numbers (typed
  // with no separator at all) were never affected, matching the "1 and
  // above works" symptom exactly.
  //
  // Second gap, confirmed live 2026-08-18 after the comma fix: the
  // backend's amount regex (`/^\d+(\.\d+)?$/`, both preview and quote
  // routes) requires at least one digit BEFORE the decimal point. Many
  // mobile decimal keypads let you type "." as the very first character
  // with no leading zero inserted, producing e.g. ".5" — which fails that
  // regex outright and surfaces as the literal "Invalid request" text
  // (see app/api/quote/btc/preview/route.ts and app/api/quote/btc/route.ts's
  // zod schemas). A whole-number amount like "1" never hits this path
  // either, matching the exact reported symptom again. Prepend a leading
  // "0" whenever the normalized value starts with a bare ".".
  //
  // Normalized once here so every consumer downstream (preview fetch,
  // quote POST, atomic-amount conversion) keeps working with a single
  // well-formed dot-decimal source of truth.
  const handleSellAmountChange = useCallback((v: string) => {
    const normalized = v.replace(",", ".");
    setSellAmount(normalized.startsWith(".") ? `0${normalized}` : normalized);
  }, []);
  const [destAddress, setDestAddress] = useState("");
  // Multi-wallet auto-fill (2026-08-07, Relay's own app does this): when the
  // user has BOTH a Solana and an EVM wallet connected and picks a
  // cross-chain destination, default the recipient to their own connected
  // wallet on that chain instead of making them copy-paste their own
  // address. Tracks whether the CURRENT value came from that auto-fill or
  // from the user actually typing/pasting something — only auto-fill
  // overwrites; a manual edit is never silently clobbered by a later
  // buyToken change.
  const [destAddressManuallyEdited, setDestAddressManuallyEdited] = useState(false);
  const [slippageBps, setSlippageBps] = useState(100); // 1% default, was hardcoded with no UI control before 2026-08-03
  const [autoRefuel, setAutoRefuel] = useState(false); // Just-In-Time Gas (2026-08-07), default off — see SwapPanel.tsx's toggle doc
  const [mevShield, setMevShield] = useState(false); // MEV Shield (2026-08-09), default off — Solana-origin only, see lib/client/jito.ts
  const [reviewOpen, setReviewOpen] = useState(false);
  // Mirrored up from SwapPanel's own live quote preview (see its
  // onPreviewChange doc) — used below for the Review modal's rate/
  // minimum-received summary, 2026-08-06 swap revamp.
  const [preview, setPreview] = useState<{
    destAmountFormatted: string | null;
    destAmountUsd: string | null;
    feeBreakdown?: Array<{ label: string; bps: number; amountUsd: string | null }>;
    route?: Array<{ label: string; engine: "jupiter" | "relay" }>;
    autoRefuelAvailable?: boolean;
  } | null>(null);

  const [step, setStep] = useState<Step>("idle");
  const [erroredAtStep, setErroredAtStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Transaction-progress drawer (2026-08-07) — auto-opens at the start of
  // every run (see the `step === "quoting"` effect below, near stepDefs);
  // closing it never cancels the in-flight runSwap(), it's display-only.
  const [progressDrawerOpen, setProgressDrawerOpen] = useState(false);

  // Activity drawer data sources (2026-08-06 visual pass) — see
  // app/components/ActivityDrawer.tsx and the three lib/client/use* hooks
  // for the shared localStorage pattern.
  const { addPair } = useRecentPairs();
  const { addAddress } = useSavedAddresses();
  const { addActivity } = useSessionActivity();
  const [swapId, setSwapId] = useState<string | null>(null);

  const evmWallet = useEvmWallet();
  const btcWallet = useBtcWallet();
  // Sui wallet (2026-08-18, rewritten 2026-08-18c perf pass) —
  // lib/client/SuiWalletProvider.tsx is now a hand-built provider on
  // @mysten/wallet-standard directly (was @mysten/dapp-kit — see that
  // file's own doc for why), same shape as useEvmWallet()/useBtcWallet().
  const sui = useSuiWallet();

  // Meaningful in both directions now that Sell isn't Solana-only — see
  // STATE.md 2026-07-18i.
  const isCrossChain = sellToken !== null && buyToken !== null && sellToken.chainId !== buyToken.chainId;

  // Whether the wallet that needs to be connected/ready to actually sell is
  // Solana or EVM — real user report 2026-08-06: every readiness check on
  // this page (the main button, canOpenReview, runSwap's own entry guard)
  // used to hard-require a Solana `publicKey` unconditionally, even when
  // selling from an EVM chain where Solana plays no functional role at
  // all — a user with ONLY an EVM wallet connected could never get past
  // "Connect wallet" no matter what they did. Hoisted to the top level
  // (was previously computed a second time, Solana-balance-hook-only,
  // inside runSwap as a local) so every gate below can share one source of
  // truth instead of some checking the right wallet and some not.
  const sellIsSolana = sellToken?.chainId === SOLANA_CHAIN_ID_CLIENT;

  // BTC/Sui pairs (2026-08-08b, Sui added 2026-08-18) — both are real,
  // selectable chains in the main picker now (see SwapPanel.tsx's
  // isBuyTokenAllowed constraint: either side is only ever paired with
  // native SOL or native Ethereum ETH), but their execution engine is
  // ChangeNOW, not Jupiter/Relay — runBtcSwap() below is an entirely
  // separate code path from runSwap(), never entered unless one side is
  // BTC or Sui. Name kept as isBtcPair to minimize diff on a real-money
  // flow — see runBtcSwap's own doc.
  const isBtcPair =
    sellToken?.chainId === BTC_CHAIN_ID ||
    buyToken?.chainId === BTC_CHAIN_ID ||
    sellToken?.chainId === SUI_CHAIN_ID ||
    buyToken?.chainId === SUI_CHAIN_ID;

  // Whether a Relay leg (the "leg2_pending" phase below) is needed at all —
  // broader than isCrossChain since 2026-08-06 (same-chain EVM support):
  // same-chain Solana needs no Relay leg (pure Jupiter, unchanged); every
  // other combination — cross-chain from either origin, AND same-chain EVM,
  // new — routes through Relay. See app/components/SwapPanel.tsx's
  // isBuyTokenAllowed doc for why same-chain EVM is real and supported now.
  // BTC pairs never need this — runBtcSwap() has its own single-leg flow.
  const needsRelayLeg2 = !isBtcPair && (isCrossChain || !sellIsSolana);

  // The user's own connected wallet address on the Buy side's chain family,
  // when they have one connected — null if they don't (e.g. only a Solana
  // wallet connected, but buying on an EVM chain), in which case there's
  // nothing to auto-fill and the field behaves exactly as before (manual
  // paste required).
  const ownDestAddress = buyToken
    ? buyToken.chainId === BTC_CHAIN_ID
      ? (btcWallet.address ?? null)
      : buyToken.chainId === SUI_CHAIN_ID
      ? sui.address
      : buyToken.chainId === SOLANA_CHAIN_ID_CLIENT
      ? (publicKey?.toBase58() ?? null)
      : (evmWallet.address ?? null)
    : null;

  // Resets to "not manually edited" whenever the Buy chain itself changes
  // (a new destination = a fresh default, not a stale override from a
  // different chain) — an actual edit on THIS chain re-flips it to true via
  // handleDestAddressChange below.
  const lastAutoFillChainRef = useRef<number | null>(null);
  useEffect(() => {
    let ignore = false;
    if (buyToken?.chainId !== lastAutoFillChainRef.current) {
      lastAutoFillChainRef.current = buyToken?.chainId ?? null;
      // Deferred to a microtask (same pattern as CollectionPageClient.tsx's
      // mount-skip guards) rather than a synchronous setState call in the
      // effect body — avoids the react-hooks/set-state-in-effect lint rule
      // by construction, not by suppressing it.
      Promise.resolve().then(() => {
        if (!ignore) setDestAddressManuallyEdited(false);
      });
    }
    return () => {
      ignore = true;
    };
  }, [buyToken?.chainId]);

  useEffect(() => {
    if (!isCrossChain || destAddressManuallyEdited || !ownDestAddress || destAddress === ownDestAddress) return;
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) setDestAddress(ownDestAddress);
    });
    return () => {
      ignore = true;
    };
  }, [isCrossChain, destAddressManuallyEdited, ownDestAddress, destAddress]);

  function handleDestAddressChange(value: string) {
    setDestAddressManuallyEdited(true);
    setDestAddress(value);
  }

  function applyOwnDestAddress() {
    if (!ownDestAddress) return;
    setDestAddressManuallyEdited(false);
    setDestAddress(ownDestAddress);
  }

  const { balance: solanaSellBalance, loading: solanaSellBalanceLoading } = useSolanaBalance(
    connection,
    sellIsSolana ? publicKey : null,
    sellIsSolana && sellToken ? { address: sellToken.address, decimals: sellToken.decimals, isNative: sellToken.isNative } : null,
  );
  // 2026-08-06 (swap page revamp, real user request) — closes the
  // Solana-only gap useSolanaBalance.ts's own comment used to flag: Max/
  // balance now work for an EVM sell token too, reusing the same
  // /api/tokens/balances endpoint the token picker's "Your tokens" section
  // already calls (lib/client/useEvmTokenBalance.ts).
  // BTC has no balance fetcher (no blockchain-explorer API wired into this
  // app) — sellToken.chainId === BTC_CHAIN_ID deliberately excluded from
  // both hooks below so it stays null (hides the balance row/Max button
  // entirely, same "null = honestly unknown" convention every other
  // unpriced/unfetched value in this app follows) rather than querying
  // Bitcoin's chain id against the EVM balances endpoint for a meaningless
  // empty result.
  const sellIsBtc = sellToken?.chainId === BTC_CHAIN_ID;
  // Sui (2026-08-18): same "no balance fetcher" treatment as BTC above —
  // this endpoint doesn't feed the Sell-side balance/Max UI (a separate
  // feature); the ChangeNOW swap flow itself doesn't need it, same as
  // BTC never has.
  const sellIsSui = sellToken?.chainId === SUI_CHAIN_ID;
  const { balance: evmSellBalance, loading: evmSellBalanceLoading } = useEvmTokenBalance(
    !sellIsSolana && !sellIsBtc && !sellIsSui && sellToken ? sellToken.chainId : null,
    !sellIsSolana && !sellIsBtc && !sellIsSui ? evmWallet.address : null,
    !sellIsSolana && !sellIsBtc && !sellIsSui && sellToken ? sellToken.address : null,
  );
  const sellBalance = sellIsBtc || sellIsSui ? null : sellIsSolana ? solanaSellBalance : evmSellBalance;
  const sellBalanceLoading = sellIsBtc || sellIsSui ? false : sellIsSolana ? solanaSellBalanceLoading : evmSellBalanceLoading;

  // Real user report 2026-08-06: picking an Arbitrum (or any non-Ethereum
  // EVM) sell token and connecting a wallet still left the wallet on
  // whatever chain it happened to already be on — the header's Connect
  // Wallet menu is a page-agnostic global component (used everywhere, not
  // just here) with no idea this page currently wants Arbitrum. This mirrors
  // the NFT buy flow's own proactive `ensureChain` call rather than only
  // switching chains at the final swap-signing step (line ~239 below) — a
  // buyer should see/approve the chain switch as soon as it's clear it's
  // needed, not be surprised by a late prompt right before signing.
  // `switchChain` is idempotent (already-correct chain = instant no-op, no
  // prompt), so this is safe to call whenever the pairing changes; the ref
  // just avoids re-firing on every unrelated re-render for the same pairing.
  const lastEnsuredChainRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !evmWallet.address ||
      !sellToken ||
      sellToken.chainId === SOLANA_CHAIN_ID_CLIENT ||
      sellToken.chainId === BTC_CHAIN_ID ||
      sellToken.chainId === SUI_CHAIN_ID
    )
      return;
    const key = `${evmWallet.address}:${sellToken.chainId}`;
    if (lastEnsuredChainRef.current === key) return;
    lastEnsuredChainRef.current = key;
    evmWallet.ensureChain(sellToken.chainId).catch(() => {
      // Best-effort — a decline or a wallet missing this chain's config
      // isn't fatal here; runSwap's own ensureChain call is the
      // authoritative, blocking check right before signing.
    });
  }, [evmWallet, sellToken]);

  // Default Sell side to native SOL, matching the reference UI's prefilled
  // state — UNLESS ?sell=&buy= are both present and resolve to real chains
  // (2026-08-07, arriving from a /swap/[pair] landing page's "Continue to
  // full swap" CTA — see app/components/QuotePreviewWidget.tsx's swapHref),
  // in which case both sides prefill to those chains' native tokens
  // instead. Reuses the same fetchNativeToken helper the widget uses — this
  // used to be a third copy of the same inline fetch/find(isNative) logic.
  useEffect(() => {
    const sellSlug = searchParams.get("sell");
    const buySlug = searchParams.get("buy");
    // resolveSwapChainSlug (not the plainer swapChainForSlug) so a
    // "bitcoin"/"sui" slug from a new BTC/Sui swap-pair landing page's
    // "Continue to full swap" link (2026-08-18) also prefills correctly —
    // those two chains are deliberately excluded from SWAP_CHAINS itself
    // (see BTC_CHAIN_ID/SUI_CHAIN_ID's own docs), so the plain lookup would
    // silently fail to prefill for exactly the pairs the new pages target.
    const sellChain = sellSlug ? resolveSwapChainSlug(sellSlug) : undefined;
    const buyChain = buySlug ? resolveSwapChainSlug(buySlug) : undefined;
    let ignore = false;

    if (sellChain && buyChain) {
      fetchNativeToken(sellChain.chainId, sellChain.label).then((t) => {
        if (!ignore && t) setSellToken(t);
      });
      fetchNativeToken(buyChain.chainId, buyChain.label).then((t) => {
        if (!ignore && t) setBuyToken(t);
      });
    } else {
      fetchNativeToken(SOLANA_CHAIN_ID_CLIENT, "Solana").then((t) => {
        if (!ignore && t) setSellToken(t);
      });
    }

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Meme Radar quick-buy handoff (2026-08-07): ?radarMint=&radarUsd=,
  // arriving from a /radar quick-buy chip. Independent of the ?sell=&buy=
  // chain-slug prefill above (which already defaults Sell to native SOL
  // when neither is present) — this resolves the SPECIFIC token via the
  // same /api/tokens/list search endpoint the token-select modal uses for a
  // pasted address, then converts the USD preset into a SOL amount using a
  // real live price (never a hardcoded SOL/USD rate).
  useEffect(() => {
    const radarMint = searchParams.get("radarMint");
    const radarUsdRaw = searchParams.get("radarUsd");
    const radarUsd = radarUsdRaw ? Number(radarUsdRaw) : NaN;
    if (!radarMint || !Number.isFinite(radarUsd) || radarUsd <= 0) return;
    let ignore = false;

    fetch(`/api/tokens/list?chainId=${SOLANA_CHAIN_ID_CLIENT}&term=${encodeURIComponent(radarMint)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: { tokens?: Array<{ address: string; symbol: string; name: string; decimals: number; logoURI: string }> }) => {
        if (ignore) return;
        const match = (body.tokens ?? []).find((t) => t.address === radarMint);
        if (!match) return;
        setBuyToken({
          chainId: SOLANA_CHAIN_ID_CLIENT,
          address: match.address,
          symbol: match.symbol,
          name: match.name,
          decimals: match.decimals,
          logoURI: match.logoURI,
          chainDisplayName: "Solana",
          chainIconUrl: null,
          isNative: false,
        });
      })
      .catch(() => {});

    fetch("/api/tokens/price")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: { solUsdPrice: number }) => {
        if (!ignore && body.solUsdPrice > 0) setSellAmount((radarUsd / body.solUsdPrice).toFixed(6));
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flip() {
    // Only swap sides if the result would still be a valid Buy-side pick —
    // reuses the exact same rule the Buy modal itself enforces (native-SOL-
    // only on Solana, no same-non-Solana-chain hop). Wallet-connection state
    // for the new Sell side is deliberately NOT checked here — only at
    // runSwap() time — so flipping stays a pure state-swap.
    if (!buyToken || !sellToken) return;
    if (!isBuyTokenAllowed(buyToken.chainId, sellToken)) {
      // Real gap fixed 2026-08-03: this used to just silently do nothing,
      // with zero feedback about why the click had no effect.
      setMessage(`Can't flip — ${buyToken.symbol} on ${buyToken.chainDisplayName} isn't a valid Sell-side token yet.`);
      return;
    }
    setSellToken(buyToken);
    setBuyToken(sellToken);
  }

  const amount = Number(sellAmount);
  const hasValidInput = Boolean(sellToken && buyToken && sellAmount && Number.isFinite(amount) && amount > 0);
  const destAddressError =
    isCrossChain && destAddress && buyToken && !isValidDestAddress(destAddress, buyToken.chainId)
      ? `Doesn't look like a valid ${
          buyToken.chainId === SOLANA_CHAIN_ID_CLIENT
            ? "Solana"
            : buyToken.chainId === BTC_CHAIN_ID
              ? "Bitcoin"
              : buyToken.chainId === SUI_CHAIN_ID
                ? "Sui"
                : "EVM"
        } address.`
      : null;
  // The wallet that actually needs to be connected to sell — Solana for a
  // Solana sell token, Bitcoin for a BTC sell token, Sui for a Sui sell
  // token, the EVM wallet for anything else. Both the button and
  // canOpenReview need this same check (see sellIsSolana's own comment
  // above for the real bug this fixes).
  const sellWalletReady = sellIsSolana
    ? Boolean(publicKey)
    : sellIsBtc
      ? Boolean(btcWallet.address)
      : sellIsSui
        ? Boolean(sui.address)
        : Boolean(evmWallet.address);
  const canOpenReview =
    Boolean(sellWalletReady && sellToken && buyToken && hasValidInput) &&
    (!isCrossChain || (Boolean(destAddress) && !destAddressError)) &&
    step === "idle";

  // Records a terminal swap outcome into the activity drawer's local stores
  // (2026-08-06 visual pass) — "done" also records the pair and, for a
  // cross-chain swap, the destination address; "error" only records the
  // activity-log entry. sellToken/buyToken are captured by reference at
  // call time (both guaranteed non-null by runSwap's own top-of-function
  // guard before any call site below can be reached).
  function recordSwapResult(finalStatus: "done" | "error", swapIdForRecord: string) {
    if (!sellToken || !buyToken) return;
    addActivity({ swapId: swapIdForRecord, sellSymbol: sellToken.symbol, buySymbol: buyToken.symbol, status: finalStatus });
    if (finalStatus === "done") {
      addPair({ sellChainId: sellToken.chainId, sellSymbol: sellToken.symbol, buyChainId: buyToken.chainId, buySymbol: buyToken.symbol });
      if (isCrossChain && destAddress) {
        addAddress({ chainId: buyToken.chainId, chainDisplayName: buyToken.chainDisplayName, address: destAddress });
      }
    }
  }

  // Entirely separate flow from runSwap() below — ChangeNOW's custodial
  // deposit-address model has no signable "leg 1" the way Jupiter/Relay do
  // (see app/api/quote/btc/route.ts's doc), so it doesn't fit that
  // function's step model. Reuses the same `step`/`message`/`swapId` state
  // (and the same progress-drawer/stepper UI, via needsRelayLeg2 being
  // false for a BTC pair — see that flag's own comment) so the visible
  // experience is one continuous flow to the user despite the different
  // code path underneath.
  async function runBtcSwap() {
    if (!sellToken || !buyToken) {
      setMessage("Pick both tokens first.");
      return;
    }
    const sourceCurrency = btcFlowCurrency(sellToken);
    const destCurrency = btcFlowCurrency(buyToken);
    // Real gap found live 2026-08-18 (user report): this used to ONLY ever
    // read the connected wallet's own address, completely ignoring the
    // typed destAddress field runSwap() below already lets every other
    // pair use — meaning a BTC/Sui-origin swap forced connecting (and,
    // via requireSession() downstream, signing in with) a destination-side
    // wallet even for a user who just wants to paste a receiving address
    // they already have, exactly like every other cross-chain pair on
    // this page already supports. Prefer the typed field when it's
    // present and valid for the destination chain; fall back to the
    // connected wallet's own address otherwise (unchanged behavior for
    // anyone who hasn't typed one).
    const typedDestAddr = destAddress && buyToken && isValidDestAddress(destAddress, buyToken.chainId) ? destAddress : null;
    const destAddr =
      typedDestAddr ??
      (destCurrency === "btc"
        ? btcWallet.address
        : destCurrency === "sui"
          ? sui.address
          : destCurrency === "sol"
            ? publicKey?.toBase58()
            : evmWallet.address);
    if (sourceCurrency === "btc" && !btcWallet.address) {
      setMessage("Connect a Bitcoin wallet to sell BTC.");
      return;
    }
    if (sourceCurrency === "sui" && !sui.address) {
      setMessage("Connect a Sui wallet to sell SUI.");
      return;
    }
    if (sourceCurrency === "sol" && (!publicKey || !signTransaction)) {
      setMessage("Connect a Solana wallet to sell SOL.");
      return;
    }
    if (sourceCurrency === "eth" && !evmWallet.address) {
      setMessage("Connect an EVM wallet to sell ETH.");
      return;
    }
    // Real gap found live 2026-08-18 (user report, "arbitrum to SUI?"): the
    // Sell-token picker restricts EVM choices for a ChangeNOW pair (see
    // SwapPanel.tsx's isSellTokenAllowedForBtcPair), but this is the same
    // "don't trust the picker to be the only gate" discipline the rest of
    // this function already applies to wallet connection — belt-and-braces
    // in case sellToken was set before buyToken (the filter is keyed off
    // buyToken, so an already-picked, now-unsupported chain could survive a
    // later Buy change) or via a prefilled ?sell= URL param.
    if (sourceCurrency === "eth" && "error" in resolveChangeNowFromNetwork("eth", sellToken.chainId)) {
      setMessage("This network isn't supported for this pair yet — pick a different chain to sell from.");
      return;
    }
    if (!destAddr) {
      setMessage(
        destCurrency === "btc"
          ? "Connect a Bitcoin wallet first."
          : destCurrency === "sui"
            ? "Connect a Sui wallet first."
            : destCurrency === "sol"
              ? "Connect a Solana wallet first."
              : "Connect an EVM wallet first.",
      );
      return;
    }

    let phase: Step = "quoting";
    let recordedSwapId = "";
    setStep(phase);
    setErroredAtStep(null);
    setMessage(null);
    try {
      const quoteRes = await fetch("/api/quote/btc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceCurrency,
          sourceAmount: sellAmount,
          destCurrency,
          destAddress: destAddr,
          // Real gap found live 2026-08-18 (user report, "arbitrum to
          // SUI?") — tells the server which actual chain this ETH is
          // coming from, so it quotes (and later signs) the right
          // network instead of always assuming Ethereum mainnet. A no-op
          // for every non-"eth" currency (server ignores it).
          sourceChainId: sourceCurrency === "eth" ? String(sellToken.chainId) : undefined,
        }),
      });
      if (!quoteRes.ok) throw new Error((await quoteRes.json()).error ?? "Quote failed");
      const { quoteId } = await quoteRes.json();

      phase = "leg1_signing";
      setStep(phase);
      const execRes = await fetch("/api/swap/btc/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      if (!execRes.ok) throw new Error((await execRes.json()).error ?? "Failed to create exchange");
      const execBody = await execRes.json();
      setSwapId(execBody.swapId);
      recordedSwapId = execBody.swapId;

      setMessage(`Confirm the ${sourceCurrency.toUpperCase()} payment in your wallet…`);
      if (execBody.depositCurrency === "btc") {
        await btcWallet.sendPayment(execBody.depositAddress, Number(execBody.depositAmount));
      } else if (execBody.depositCurrency === "sui") {
        // MIST has 9 decimals, same convention as SUI_CHAIN_INFO's
        // nativeCurrency — matches how lamports/wei are derived for
        // SOL/ETH just below.
        const mist = BigInt(Math.round(Number(execBody.depositAmount) * 1e9));
        const tx = buildSuiTransferTransaction({ toAddress: execBody.depositAddress, mist });
        await sui.signAndExecuteTransaction({ transaction: tx });
      } else if (execBody.depositCurrency === "sol") {
        const lamports = Math.round(Number(execBody.depositAmount) * 1e9);
        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction({ feePayer: publicKey!, recentBlockhash: blockhash }).add(
          SystemProgram.transfer({ fromPubkey: publicKey!, toPubkey: new PublicKey(execBody.depositAddress), lamports }),
        );
        const signed = await signTransaction!(tx);
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, "confirmed");
      } else {
        const weiAmount = toAtomicAmount(execBody.depositAmount, 18);
        // Real gap found live 2026-08-18 (user report, "arbitrum to
        // SUI?"): this used to hardcode chainId: 1 (Ethereum mainnet)
        // regardless of which EVM chain the Sell token actually came
        // from — silently redirecting the signing prompt to mainnet even
        // when the user picked, say, Arbitrum. execBody.depositChainId
        // is the exact chain /api/quote/btc quoted against (see that
        // route's doc for why these are guaranteed to match); falls back
        // to mainnet only for pre-existing quote rows that predate this
        // field, preserving the old behavior for those.
        await evmWallet.sendStepAndWait({
          from: evmWallet.address!,
          to: execBody.depositAddress,
          data: "0x",
          value: weiAmount,
          chainId: execBody.depositChainId ?? 1,
        });
      }

      phase = "leg1_confirming";
      setStep(phase);
      setMessage("Payment sent — waiting for the exchange to settle (this can take a few minutes)…");
      for (let attempt = 0; attempt < 60; attempt++) {
        await sleep(5000);
        const confirmRes = await fetch("/api/swap/btc/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ swapId: execBody.swapId }),
        });
        if (!confirmRes.ok) throw new Error((await confirmRes.json()).error ?? "Confirm failed");
        const confirmed = await confirmRes.json();
        if (confirmed.status === "complete") {
          setStep("done");
          recordSwapResult("done", recordedSwapId);
          setMessage("Swap complete.");
          return;
        }
        if (confirmed.status === "leg1_failed") {
          throw new Error("Exchange failed — safe to retry, contact support if funds were already sent.");
        }
      }
      throw new Error("Taking longer than expected — check back shortly, it may still settle.");
    } catch (err) {
      setStep("error");
      setErroredAtStep(phase);
      recordSwapResult("error", recordedSwapId);
      setMessage((err as Error).message);
    }
  }

  async function runSwap() {
    if (!sellToken || !buyToken) {
      setMessage("Pick both tokens first.");
      return;
    }
    if (sellIsSolana && (!publicKey || !signTransaction)) {
      setMessage("Connect a Solana wallet to sell this token.");
      return;
    }
    if (!sellIsSolana && !evmWallet.address) {
      setMessage(`Connect an EVM wallet to sell from ${sellToken.chainDisplayName}.`);
      return;
    }
    if (isCrossChain && !destAddress) {
      setMessage("Enter a destination address.");
      return;
    }

    // Tracks the in-progress phase independently of the `step` state
    // variable — `step` here is a snapshot from whichever render created
    // this function instance and does NOT reflect `setStep(...)` calls made
    // later in this same execution (that's how React state closures work).
    // Needed so a mid-flow failure can mark the SPECIFIC stepper stage that
    // failed, not just "something failed somewhere".
    let phase: Step = "quoting";
    let recordedSwapId = ""; // set once /api/swap returns a real swapId; used by recordSwapResult below
    setStep(phase);
    setErroredAtStep(null);
    setMessage(null);
    try {
      const sourceMint = normalizeSolanaSourceMint(sellToken.address);
      const quoteRes = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceChainId: sellToken.chainId,
          sourceMint,
          sourceAddress: sellIsSolana ? undefined : evmWallet.address,
          sourceAmount: toAtomicAmount(sellAmount, sellToken.decimals),
          // Both driven by buyToken's own chain, not by isCrossChain — that
          // ternary used to hardcode Solana whenever !isCrossChain, which was
          // harmless before 2026-08-06 (the only way to reach !isCrossChain
          // was same-chain Solana, where buyToken.chainId already equals
          // SOLANA_CHAIN_ID_CLIENT anyway) but was silently wrong for the new
          // same-chain-EVM case (would send Solana as the destination for an
          // EVM->EVM swap). buyToken.chainId is correct unconditionally.
          destChainId: buyToken.chainId,
          // "SOL" sentinel only for an actual native-SOL pick — same fix as
          // SwapPanel.tsx's preview fetch (2026-08-07): this used to force
          // "SOL" for ANY Solana buyToken, silently executing a swap into
          // native SOL even when the user had picked a different SPL token.
          destToken: buyToken.chainId === SOLANA_CHAIN_ID_CLIENT ? (buyToken.isNative ? "SOL" : buyToken.address) : buyToken.address,
          // Cross-chain uses the explicit destAddress field. Same-chain
          // Solana has no such field — defaults to the connected Solana
          // wallet (publicKey guaranteed non-null here by the sellIsSolana
          // guard above). Same-chain EVM (new) is likewise a self-swap with
          // no destAddress field — defaults to the connected EVM wallet
          // (evmWallet.address guaranteed non-null by the !sellIsSolana
          // guard above).
          destAddress: isCrossChain ? destAddress : sellIsSolana ? publicKey!.toBase58() : evmWallet.address!,
          slippageBps,
          autoRefuel,
        }),
      });
      if (!quoteRes.ok) throw new Error((await quoteRes.json()).error ?? "Quote failed");
      const { quoteId } = await quoteRes.json();

      phase = "leg1_signing";
      setStep(phase);
      const swapRes = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      if (!swapRes.ok) throw new Error((await swapRes.json()).error ?? "Swap build failed");
      const { swapId: newSwapId, status, unsignedTransaction } = await swapRes.json();
      setSwapId(newSwapId);
      recordedSwapId = newSwapId;

      if (unsignedTransaction) {
        // /api/swap only ever returns a non-null unsignedTransaction for a
        // Solana-origin quote (see that route's own comment) — signTransaction
        // is guaranteed non-null here by the sellIsSolana guard above.
        const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTransaction, "base64"));

        // Pre-flight simulation (2026-08-10, PLAN_SANDBOX_SIMULATION.md) —
        // catches a transaction that's guaranteed to fail on-chain BEFORE
        // prompting a wallet signature, and surfaces the real expected
        // output. Simulation failures other than an outright `err` (rate
        // limits, RPC hiccups) don't block the swap — this is a safety net
        // on top of the existing flow, not a new hard dependency.
        const sim = await simulateSwapTransaction(connection, tx, publicKey!.toBase58());
        if (!sim.ok && sim.error) {
          throw new Error(`Simulation shows this swap would fail on-chain: ${sim.error}`);
        }
        if (sim.ok) {
          const received = sim.tokenDeltas.find((d) => d.uiAmountDelta > 0);
          if (received) {
            setMessage(`Simulated result: you'll receive ~${received.uiAmountDelta.toFixed(6)} of the destination token — confirm in your wallet…`);
          }
        }

        const signed = await signTransaction!(tx);
        // MEV Shield (2026-08-09) — mirrors executeSwapFlow.ts's own fix,
        // kept separate per that file's convention for this page. Routes
        // through Jito's private relay instead of the public RPC when
        // opted in, so a sandwich bot never sees this in the public
        // mempool before it lands.
        const signature = mevShield && sellIsSolana ? await sendViaJito(signed) : await connection.sendRawTransaction(signed.serialize());

        phase = "leg1_confirming";
        setStep(phase);
        const confirmRes = await fetch("/api/swap/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ swapId: newSwapId, signature }),
        });
        if (!confirmRes.ok) throw new Error((await confirmRes.json()).error ?? "Confirm failed");
        const confirmed = await confirmRes.json();
        if (confirmed.status === "complete") {
          setStep("done");
          recordSwapResult("done", recordedSwapId);
          setMessage("Swap complete.");
          return;
        }
      } else if (status !== "leg1_confirmed") {
        setStep("done");
        recordSwapResult("done", recordedSwapId);
        setMessage("Swap complete.");
        return;
      }

      if (needsRelayLeg2) {
        phase = "leg2_pending";
        setStep(phase);
        setMessage(isCrossChain ? "Preparing bridge deposit…" : "Preparing swap…");
        const bridgeRes = await fetch("/api/bridge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ swapId: newSwapId }),
        });
        if (!bridgeRes.ok) throw new Error((await bridgeRes.json()).error ?? (isCrossChain ? "Bridge init failed" : "Swap init failed"));
        const { steps } = await bridgeRes.json();

        if (sellIsSolana) {
          // This "deposit" step is a Solana transaction even though it
          // bridges to another chain — same connected Solana wallet, no
          // EVM signature needed. See lib/chains/relay.ts. Only reachable
          // when isCrossChain (needsRelayLeg2 is false for same-chain
          // Solana), so "bridge" copy here is always accurate.
          const depositItem = steps?.[0]?.items?.[0];
          if (!depositItem?.data?.instructions) {
            throw new Error("Bridge step did not include deposit instructions");
          }

          setMessage("Confirm the bridge deposit transaction in your wallet…");
          // publicKey/signTransaction guaranteed non-null here — this whole
          // branch is gated on sellIsSolana, which the top-of-function guard
          // already required both for.
          const depositTx = await buildRelayDepositTransaction({
            connection,
            payer: publicKey!,
            instructions: depositItem.data.instructions,
            addressLookupTableAddresses: depositItem.data.addressLookupTableAddresses,
          });
          const signedDeposit = await signTransaction!(depositTx);
          await connection.sendRawTransaction(signedDeposit.serialize());
        } else {
          // Non-Solana origin: one or more real EVM transactions. Cross-chain:
          // an ERC20 origin returns a separate leading "approve" step before
          // "deposit"; a native-currency origin (ETH, MATIC, ...) returns just
          // "deposit". Same-chain (2026-08-06, new): a single "swap" step,
          // same iterate-whatever-comes-back handling — this loop was already
          // step-id-generic, only the display label needed a case for it. See
          // STATE.md 2026-07-18i and lib/client/useEvmWallet.ts.
          await evmWallet.ensureChain(sellToken.chainId);
          for (let i = 0; i < steps.length; i++) {
            const item = steps[i]?.items?.[0];
            if (!item?.data) throw new Error(`Swap step "${steps[i]?.id}" did not include transaction data`);
            const label = steps[i].id === "approve" ? "Approve token spend" : isCrossChain ? "Confirm deposit" : "Confirm swap";
            setMessage(`Step ${i + 1} of ${steps.length}: ${label} in your wallet…`);
            await evmWallet.sendStepAndWait(item.data);
          }
        }

        setMessage(
          isCrossChain
            ? "Deposit submitted — waiting for the bridge to settle (usually a few seconds)…"
            : "Swap submitted — waiting for it to confirm (usually a few seconds)…",
        );
        // Stall Transparency Panel (2026-08-09) — mirrors the same fix in
        // lib/client/executeSwapFlow.ts's own polling loop (kept separate
        // per that file's own doc comment on why this page's flow isn't
        // refactored to share it) — surfaces Relay's REAL intent status
        // once polling has run long enough that a static message would
        // start reading as a stall, and gives refund a distinct, honest
        // message instead of a generic failure.
        const STALL_THRESHOLD_ATTEMPTS = 5;
        const RELAY_STATUS_COPY: Record<string, string> = {
          pending: "Relay's solver network is still processing this fill…",
          received: "Deposit received — waiting for the destination delivery…",
        };
        for (let attempt = 0; attempt < 40; attempt++) {
          await sleep(3000);
          const confirmRes = await fetch("/api/bridge/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ swapId: newSwapId }),
          });
          if (!confirmRes.ok) throw new Error((await confirmRes.json()).error ?? "Confirm failed");
          const confirmed = await confirmRes.json();
          if (confirmed.status === "complete") {
            setStep("done");
            recordSwapResult("done", recordedSwapId);
            setMessage("Swap complete.");
            return;
          }
          if (confirmed.status === "leg2_failed") {
            if (confirmed.relayStatus === "refund") {
              throw new Error("Relay is refunding your deposit — this fill couldn't complete, but your funds are being returned automatically.");
            }
            throw new Error(
              isCrossChain
                ? sellIsSolana
                  ? "Bridge settlement failed — funds remain as SOL in your wallet, safe to retry."
                  : "Bridge settlement failed — your deposit did not complete, safe to retry."
                : "Swap failed — your funds were not moved, safe to retry.",
            );
          }
          if (attempt >= STALL_THRESHOLD_ATTEMPTS && RELAY_STATUS_COPY[confirmed.relayStatus]) {
            setMessage(RELAY_STATUS_COPY[confirmed.relayStatus]);
          }
        }
        throw new Error(
          isCrossChain
            ? "Bridge is taking longer than expected — check back shortly, it may still settle."
            : "Swap is taking longer than expected — check back shortly, it may still settle.",
        );
      } else {
        setStep("done");
        recordSwapResult("done", recordedSwapId);
        setMessage("Swap complete.");
      }
    } catch (err) {
      setStep("error");
      setErroredAtStep(phase);
      // recordedSwapId may still be "" if the failure happened before
      // /api/swap ever returned one (e.g. the initial quote request) —
      // recordSwapResult only needs sellToken/buyToken to be set, which
      // runSwap's own top-of-function guard already guarantees.
      recordSwapResult("error", recordedSwapId);
      setMessage((err as Error).message);
    }
  }

  const busy = step === "quoting" || step === "leg1_signing" || step === "leg1_confirming" || step === "leg2_pending";
  const isError = step === "error";
  const isDone = step === "done";

  // Auto-open the progress drawer at the exact start of every run (fresh or
  // a "Try again"/"Swap again" retry — runSwap() sets step to "quoting"
  // unconditionally as its very first action, never passing back through
  // "idle" first on a retry, so this fires exactly once per run either way).
  useEffect(() => {
    if (step !== "quoting") return;
    // Deferred via Promise.resolve().then(...) — same pattern
    // lib/client/ThemeToggle.tsx/ActivityDrawer.tsx already use for this
    // exact set-state-in-effect lint rule.
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) setProgressDrawerOpen(true);
    });
    return () => {
      ignore = true;
    };
  }, [step]);

  // Source/bridge/destination-aware labels (2026-08-07, progress drawer) —
  // same real steps as before, just relabeled with the actual chain names
  // now in scope here. No new backend-observable granularity invented:
  // /api/bridge/confirm still returns one combined "complete" status, so
  // "Delivered on {chain}" is the done state for the whole leg2_pending
  // step, not a separately-tracked destination-confirmation sub-step.
  const sellChainLabel = sellToken?.chainDisplayName ?? "source chain";
  const buyChainLabel = buyToken?.chainDisplayName ?? "destination chain";
  const stepDefs: SwapStep[] = [
    { key: "quoting", label: "Quote" },
    { key: "leg1_signing", label: `Sign on ${sellChainLabel}` },
    { key: "leg1_confirming", label: `Confirm on ${sellChainLabel}` },
    ...(needsRelayLeg2 ? [{ key: "leg2_pending", label: isCrossChain ? `Bridging to ${buyChainLabel}` : "Swap" }] : []),
    { key: "done", label: isCrossChain ? `Delivered on ${buyChainLabel}` : "Done" },
  ];
  const currentStepIndex = stepDefs.findIndex((s) => s.key === (isError ? erroredAtStep : step));
  const erroredIndex = isError ? stepDefs.findIndex((s) => s.key === erroredAtStep) : null;
  // Beam only for a genuine cross-chain bridge leg, not the same-chain "Swap"
  // label leg2_pending can also carry (see needsRelayLeg2's doc above) — -1
  // when not applicable, which never matches a real step index.
  const beamStepIndex = isCrossChain ? stepDefs.findIndex((s) => s.key === "leg2_pending") : -1;

  function handleMainButtonClick() {
    if (!sellWalletReady) {
      // 2026-08-06 (real user request, refined from an earlier scroll+pulse
      // attempt): this button and the header's own Connect Wallet button
      // now open the exact same modal instance — lib/client/
      // ConnectWalletModalProvider.tsx, shared state instantiated once at
      // the app root — rather than this one just pointing at the other.
      // Either button works identically, from anywhere.
      connectWalletModal.setOpen(true);
      return;
    }
    if (step === "error" || step === "done") {
      // Retry / start over — resets the flow instead of re-opening review
      // on top of a finished/failed one.
      setStep("idle");
      setMessage(null);
      setErroredAtStep(null);
    }
    setReviewOpen(true);
  }

  return (
    // AppHeader lives in this wider (`max-w-5xl`) outer container, matching
    // the NFT page's width — before this it shared the narrow `max-w-lg`
    // swap-widget column below, which made the same header component read
    // visibly smaller/more cramped here than on /nft. The swap widget itself
    // stays intentionally narrow (single-column DEX-style card), just
    // centered inside the wider row now instead of constraining the header
    // too.
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />

      {/* Points/referral side-card (2026-08-06 visual pass) — the outer
          `<main>` was already `max-w-5xl` with all of that width unused
          beyond the narrow swap column; a real 2-col grid at `lg:` puts it
          to use instead of adding a new width constraint. Single column
          (side-card stacks below) under `lg:`, unchanged from before. */}
      <div className="grid w-full gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
      {/* Plain div, not <Reveal> (2026-09-01, PSI audit) — this is the page's
          primary above-the-fold content (H1, subtext, the swap widget
          itself), visible immediately on load, not something a visitor
          scrolls to. Lighthouse's LCP breakdown identified the subtext <p>
          right below as the LCP element with 4585ms of "element render
          delay" -- almost entirely the IntersectionObserver+opacity fade-in
          this wrapper added to content that was never actually below the
          fold. Reveal is still the right tool for genuinely scrolled-to
          content (see the MORE_TOOLS section below, unchanged). */}
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        {/* 2026-08-06 (frontend audit, Impeccable detector: "flat-type-hierarchy")
            — same gap as /nft: no page-level heading at all, straight into
            the widget, so text sizes clustered with nothing bigger to anchor
            a real scale. */}
        <h1 className="font-display px-1 text-2xl font-normal text-ink">Swap</h1>
        {/* Real gap fixed 2026-08-11 (site-wide audit) — a visitor landing
            directly on /swap (a bookmark, a shared link, an ad) got zero
            context: no subtext, no trust signal, unlike the homepage which
            now has both. This is the actual page a real signature happens
            on, so it needs this more than the homepage does, not less. */}
        <p className="px-1 text-sm text-ink-muted">
          Cross-chain and same-chain swaps across Solana, Ethereum, and more — no bridging, no manual steps.
        </p>
        <TrendingBar chainId={SOLANA_CHAIN_ID_CLIENT} />

        <SwapPanel
          sellToken={sellToken}
          buyToken={buyToken}
          onSellTokenChange={setSellToken}
          onBuyTokenChange={setBuyToken}
          sellAmount={sellAmount}
          onSellAmountChange={handleSellAmountChange}
          destAddress={destAddress}
          onDestAddressChange={handleDestAddressChange}
          destAddressError={destAddressError}
          ownDestAddress={ownDestAddress}
          onUseOwnDestAddress={applyOwnDestAddress}
          isCrossChain={isCrossChain}
          onFlip={flip}
          sellBalance={sellBalance}
          sellBalanceLoading={sellBalanceLoading}
          onPreviewChange={setPreview}
          autoRefuel={autoRefuel}
          onAutoRefuelChange={setAutoRefuel}
          mevShield={mevShield}
          onMevShieldChange={setMevShield}
        />

        <SlippageControl bps={slippageBps} onChange={setSlippageBps} />
        <TrustBar />
        {/* Same real security trust line as the homepage (2026-08-11 site-
            wide audit) — right before the real signature/CTA, where trust
            signals do the most work. Same true claim, same link, reused
            verbatim for consistency rather than re-worded per page. */}
        <p className="px-1 text-xs text-ink-faint">
          🔒 Destination address locked at quote time, re-verified on-chain before every swap completes.{" "}
          <Link href="/blog/swap-security-101" className="font-medium text-accent hover:underline">
            How it works →
          </Link>
        </p>

        <button
          onClick={handleMainButtonClick}
          // 2026-08-06 (screenshot-verified real bug): !sellWalletReady used
          // to be part of this disabled condition too, which combined with
          // disabled:opacity-40 below made the PRIMARY call-to-action on
          // this page render nearly unreadable — a washed-out, ~40%-opacity
          // accent purple, exactly when a first-time visitor most needs a
          // clear "do this next" signal. Not disabled in that state anymore
          // (handleMainButtonClick now does something useful there instead
          // of nothing) — stays fully solid/legible; the other two
          // conditions (mid-flow, or ready-but-invalid-input) still
          // genuinely can't proceed and keep the disabled treatment.
          disabled={sellWalletReady && (busy || (!canOpenReview && step === "idle"))}
          className="rounded-2xl bg-accent px-4 py-3.5 text-[15px] font-semibold text-accent-ink shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {!sellWalletReady
            ? sellToken && !sellIsSolana
              ? `Connect wallet to sell from ${sellToken.chainDisplayName}`
              : "Connect wallet"
            : busy
              ? "Working…"
              : isError
                ? "Try again"
                : isDone
                  ? "Swap again"
                  : "Review swap"}
        </button>

        {/* Real step detail now lives in the slide-out progress drawer
            (2026-08-07) instead of inline in the card — see
            SwapProgressDrawer below. This link is the reopen affordance for
            when a user closes the drawer mid-swap; it's never the only way
            to see progress since the drawer auto-opens at the start of
            every run. */}
        {busy && !progressDrawerOpen && (
          <button
            onClick={() => setProgressDrawerOpen(true)}
            className="self-start text-sm font-medium text-accent transition-opacity hover:opacity-80"
          >
            View progress →
          </button>
        )}

        {message && (
          <p
            className={`rounded-xl px-3 py-2 text-sm ${
              isError
                ? "border border-danger-soft bg-danger-soft text-danger"
                : isDone
                  ? "border border-success-soft bg-success-soft text-success"
                  : "border border-hairline bg-surface text-ink-muted"
            }`}
          >
            {message}
          </p>
        )}
        {swapId && <p className="num px-1 text-xs text-ink-faint">swap {swapId}</p>}

        {/* Success-state retention block (2026-08-18) — was previously just
            the "View points & referrals" link below with no live reward
            feedback. Only renders once step reaches "done". */}
        <SwapSuccessRewards isActive={busy} isDone={isDone} swapId={swapId} />

        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 self-start text-sm font-medium text-ink-muted transition-colors hover:text-accent"
        >
          View points &amp; referrals
          <span aria-hidden="true">→</span>
        </Link>
        {/* Real internal link (2026-08-11, SEO pass) — this page had zero
            outbound links to the one blog post that explains what a
            cross-chain swap actually does under the hood; a first-time
            visitor unsure what "swap" even means here had no path to that
            explainer short of finding /blog on their own. */}
        <Link
          href="/blog/how-cross-chain-swaps-work"
          className="flex items-center gap-1.5 self-start text-sm font-medium text-ink-muted transition-colors hover:text-accent"
        >
          How does a cross-chain swap actually work?
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="mx-auto w-full max-w-lg lg:sticky lg:top-6 lg:mx-0">
        <PointsSummaryCard refreshKey={isDone ? swapId : null} />
      </div>
      </div>

      {/* Consolidated (2026-08-11 site-wide audit) — this used to be 4 big
          full-width cards, each with its own big accent CTA pill, the exact
          same "competing CTAs" anti-pattern found and fixed on the
          homepage. A first-time visitor's one real goal on THIS page is
          connecting a wallet and swapping — these are real, useful
          secondary tools, but they shouldn't visually compete with that.
          Reuses the same shared MORE_TOOLS list + compact tile pattern the
          homepage now uses, for real cross-page consistency. */}
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <h2 className="px-1 text-sm font-semibold text-ink-muted">More tools</h2>
        {/* 2026-08-12 (de-generic-ify pass, item 5) — same gap-px
            structural-grid treatment as the homepage's identical MORE_TOOLS
            tile row (app/page.tsx) — see PLAN.md's "de-AI-ify" entry. */}
        <div className="grid grid-cols-3 gap-px border border-hairline bg-hairline sm:grid-cols-5">
          {MORE_TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex flex-col items-center gap-2 bg-surface px-2 py-4 text-center transition-colors duration-100 hover:bg-surface-hover"
            >
              <span aria-hidden="true" className="text-xl">
                {tool.icon}
              </span>
              <span className="text-[11px] font-medium text-ink-muted">{tool.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/*
        Real gap fixed 2026-08-03: clicking "Swap" used to go straight from
        input to a wallet-signature prompt with zero review — no rate, no
        minimum-received, no confirmation of the destination address for a
        cross-chain swap. This is a lightweight review step, not a second
        quote (the real, binding quote is still fetched fresh by runSwap()
        itself when "Confirm" is pressed — this just summarizes what the
        user already typed before committing to it).
      */}
      {reviewOpen && sellToken && buyToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onClick={() => setReviewOpen(false)}>
          <div
            className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Review swap</h2>
              <button onClick={() => setReviewOpen(false)} className="text-ink-faint hover:text-ink" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-hover p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-faint">Sell</span>
                <span className="num text-sm font-semibold text-ink">
                  {sellAmount} {sellToken.symbol} <span className="text-ink-faint">({sellToken.chainDisplayName})</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-faint">Buy (estimated)</span>
                <span className="num text-sm font-semibold text-ink">
                  {preview?.destAmountFormatted ? `${Number(preview.destAmountFormatted).toFixed(6)} ` : ""}
                  {buyToken.symbol} <span className="text-ink-faint">({buyToken.chainDisplayName})</span>
                </span>
              </div>
              {/* 2026-08-06 (swap revamp, real user request: "clearer swap
                  summary before confirming") — rate/minimum-received were
                  previously nowhere in the review step at all; a buyer only
                  ever saw the bare estimated Buy amount with no sense of
                  the actual exchange rate or the worst-case outcome if the
                  market moved against them within their slippage
                  tolerance. Both are estimates too (see the disclaimer
                  below), same caveat as the Buy amount itself — the real
                  quote is only locked in when runSwap() actually fires. */}
              {preview?.destAmountFormatted && Number(sellAmount) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-faint">Rate</span>
                  <span className="num text-xs text-ink-muted">
                    1 {sellToken.symbol} ≈ {(Number(preview.destAmountFormatted) / Number(sellAmount)).toFixed(6)} {buyToken.symbol}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-faint">Slippage tolerance</span>
                <span className="num text-sm text-ink">{slippageBps / 100}%</span>
              </div>
              {preview?.destAmountFormatted && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-faint">Minimum received</span>
                  <span className="num text-xs text-ink-muted">
                    {(Number(preview.destAmountFormatted) * (1 - slippageBps / 10_000)).toFixed(6)} {buyToken.symbol}
                  </span>
                </div>
              )}
              {/* Route & fees — real per-leg breakdown (2026-08-06), not a
                  static "0.25% per leg" string. `feeBreakdown` comes straight
                  from GET /api/quote/preview via SwapPanel's onPreviewChange
                  (see lib/fees.ts's feeBreakdownWithAmounts) — it only lists
                  legs that actually apply to this swap's shape AND are
                  actually active (fee env var set), so an empty array here
                  correctly means "no platform fee on this swap" rather than
                  being hidden/assumed. Gas is a disclaimer, not a computed
                  number — nothing in this app converts Relay's raw gas
                  fields to USD yet, and guessing would risk a wrong figure. */}
              {preview?.feeBreakdown && preview.feeBreakdown.length > 0 ? (
                preview.feeBreakdown.map((leg) => (
                  <div key={leg.label} className="flex items-center justify-between">
                    <span className="text-xs text-ink-faint">{leg.label}</span>
                    <span className="num text-xs text-ink-muted">
                      {leg.bps / 100}%{leg.amountUsd ? ` (~$${leg.amountUsd})` : ""}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-faint">Platform fee</span>
                  <span className="text-xs text-ink-muted">None on this swap</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-faint">Network gas</span>
                <span className="text-xs text-ink-muted">Paid separately, varies by chain</span>
              </div>
              {autoRefuel && preview?.autoRefuelAvailable && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-faint">Destination gas top-up</span>
                  <span className="text-xs text-ink-muted">~$2 requested</span>
                </div>
              )}
              {isCrossChain && (
                // 2026-08-04 (security hardening pass) — was a single
                // `justify-between` row with `truncate` (CSS ellipsis
                // clipping the address to fit the label's row). The
                // underlying text was always the real full address (never
                // string-sliced), but a visually-clipped address defeats
                // the actual point of showing it here: current best
                // practice against address-poisoning attacks is the buyer
                // visually confirming the FULL destination address right
                // before signing, not a truncated preview. Stacked layout +
                // `break-all` (wraps instead of clipping) so the complete
                // address is always visible, not just available via the
                // `title` hover tooltip (which touch/mobile users can't
                // reach anyway).
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-ink-faint">Destination</span>
                  <span className="num break-all text-xs text-ink">{destAddress}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-ink-faint">
              The exact rate is locked in a fresh quote the moment you confirm — the amount above is an estimate from
              a moment ago, not a guarantee. You&apos;ll be asked to sign in your wallet next.
            </p>

            <button
              onClick={() => {
                setReviewOpen(false);
                if (isBtcPair) runBtcSwap();
                else runSwap();
              }}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Confirm swap
            </button>
          </div>
        </div>
      )}

      <SwapProgressDrawer
        open={progressDrawerOpen && step !== "idle"}
        onClose={() => setProgressDrawerOpen(false)}
        steps={stepDefs}
        currentIndex={currentStepIndex}
        erroredIndex={erroredIndex}
        beamIndex={beamStepIndex}
      />
    </main>
  );
}
