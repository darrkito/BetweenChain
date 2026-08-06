"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SOLANA_CHAIN_ID_CLIENT, normalizeSolanaSourceMint } from "@/lib/client/constants";
import { toAtomicAmount } from "@/lib/client/amount";
import { buildRelayDepositTransaction } from "@/lib/client/relayTransaction";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useSolanaBalance } from "@/lib/client/useSolanaBalance";
import { useEvmTokenBalance } from "@/lib/client/useEvmTokenBalance";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { AppHeader } from "@/app/components/AppHeader";
import { TrendingBar } from "@/app/components/TrendingBar";
import { Reveal } from "@/app/components/Reveal";
import { SwapPanel, isBuyTokenAllowed } from "@/app/components/SwapPanel";
import { SlippageControl } from "@/app/components/SlippageControl";
import { SwapStepper, type SwapStep } from "@/app/components/SwapStepper";
import type { SelectedToken } from "@/app/components/TokenSelectModal";

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
  return isPlausibleEvmAddress(address);
}

export function SwapPageClient() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const connectWalletModal = useConnectWalletModal();

  const [sellToken, setSellToken] = useState<SelectedToken | null>(null);
  const [buyToken, setBuyToken] = useState<SelectedToken | null>(null);
  const [sellAmount, setSellAmount] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [slippageBps, setSlippageBps] = useState(100); // 1% default, was hardcoded with no UI control before 2026-08-03
  const [reviewOpen, setReviewOpen] = useState(false);
  // Mirrored up from SwapPanel's own live quote preview (see its
  // onPreviewChange doc) — used below for the Review modal's rate/
  // minimum-received summary, 2026-08-06 swap revamp.
  const [preview, setPreview] = useState<{ destAmountFormatted: string | null; destAmountUsd: string | null } | null>(null);

  const [step, setStep] = useState<Step>("idle");
  const [erroredAtStep, setErroredAtStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [swapId, setSwapId] = useState<string | null>(null);

  const evmWallet = useEvmWallet();

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

  // Whether a Relay leg (the "leg2_pending" phase below) is needed at all —
  // broader than isCrossChain since 2026-08-06 (same-chain EVM support):
  // same-chain Solana needs no Relay leg (pure Jupiter, unchanged); every
  // other combination — cross-chain from either origin, AND same-chain EVM,
  // new — routes through Relay. See app/components/SwapPanel.tsx's
  // isBuyTokenAllowed doc for why same-chain EVM is real and supported now.
  const needsRelayLeg2 = isCrossChain || !sellIsSolana;

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
  const { balance: evmSellBalance, loading: evmSellBalanceLoading } = useEvmTokenBalance(
    !sellIsSolana && sellToken ? sellToken.chainId : null,
    !sellIsSolana ? evmWallet.address : null,
    !sellIsSolana && sellToken ? sellToken.address : null,
  );
  const sellBalance = sellIsSolana ? solanaSellBalance : evmSellBalance;
  const sellBalanceLoading = sellIsSolana ? solanaSellBalanceLoading : evmSellBalanceLoading;

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
    if (!evmWallet.address || !sellToken || sellToken.chainId === SOLANA_CHAIN_ID_CLIENT) return;
    const key = `${evmWallet.address}:${sellToken.chainId}`;
    if (lastEnsuredChainRef.current === key) return;
    lastEnsuredChainRef.current = key;
    evmWallet.ensureChain(sellToken.chainId).catch(() => {
      // Best-effort — a decline or a wallet missing this chain's config
      // isn't fatal here; runSwap's own ensureChain call is the
      // authoritative, blocking check right before signing.
    });
  }, [evmWallet, sellToken]);

  // Default Sell side to native SOL, matching the reference UI's prefilled state.
  useEffect(() => {
    fetch(`/api/tokens/list?chainId=${SOLANA_CHAIN_ID_CLIENT}`)
      .then((r) => r.json())
      .then((d: { tokens?: Array<{ address: string; symbol: string; name: string; decimals: number; logoURI: string; isNative: boolean }> }) => {
        const native = (d.tokens ?? []).find((t) => t.isNative);
        if (native) {
          setSellToken({
            chainId: SOLANA_CHAIN_ID_CLIENT,
            address: native.address,
            symbol: native.symbol,
            name: native.name,
            decimals: native.decimals,
            logoURI: native.logoURI,
            chainDisplayName: "Solana",
            chainIconUrl: null,
            isNative: true,
          });
        }
      })
      .catch(() => {});
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
      ? `Doesn't look like a valid ${buyToken.chainId === SOLANA_CHAIN_ID_CLIENT ? "Solana" : "EVM"} address.`
      : null;
  // The wallet that actually needs to be connected to sell — Solana for a
  // Solana sell token, the EVM wallet for anything else. Both the button
  // and canOpenReview need this same check (see sellIsSolana's own comment
  // above for the real bug this fixes).
  const sellWalletReady = sellIsSolana ? Boolean(publicKey) : Boolean(evmWallet.address);
  const canOpenReview =
    Boolean(sellWalletReady && sellToken && buyToken && hasValidInput) &&
    (!isCrossChain || (Boolean(destAddress) && !destAddressError)) &&
    step === "idle";

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
          destToken: buyToken.chainId === SOLANA_CHAIN_ID_CLIENT ? "SOL" : buyToken.address,
          // Cross-chain uses the explicit destAddress field. Same-chain
          // Solana has no such field — defaults to the connected Solana
          // wallet (publicKey guaranteed non-null here by the sellIsSolana
          // guard above). Same-chain EVM (new) is likewise a self-swap with
          // no destAddress field — defaults to the connected EVM wallet
          // (evmWallet.address guaranteed non-null by the !sellIsSolana
          // guard above).
          destAddress: isCrossChain ? destAddress : sellIsSolana ? publicKey!.toBase58() : evmWallet.address!,
          slippageBps,
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

      if (unsignedTransaction) {
        // /api/swap only ever returns a non-null unsignedTransaction for a
        // Solana-origin quote (see that route's own comment) — signTransaction
        // is guaranteed non-null here by the sellIsSolana guard above.
        const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTransaction, "base64"));
        const signed = await signTransaction!(tx);
        const signature = await connection.sendRawTransaction(signed.serialize());

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
          setMessage("Swap complete.");
          return;
        }
      } else if (status !== "leg1_confirmed") {
        setStep("done");
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
            setMessage("Swap complete.");
            return;
          }
          if (confirmed.status === "leg2_failed") {
            throw new Error(
              isCrossChain
                ? sellIsSolana
                  ? "Bridge settlement failed — funds remain as SOL in your wallet, safe to retry."
                  : "Bridge settlement failed — your deposit did not complete, safe to retry."
                : "Swap failed — your funds were not moved, safe to retry.",
            );
          }
        }
        throw new Error(
          isCrossChain
            ? "Bridge is taking longer than expected — check back shortly, it may still settle."
            : "Swap is taking longer than expected — check back shortly, it may still settle.",
        );
      } else {
        setStep("done");
        setMessage("Swap complete.");
      }
    } catch (err) {
      setStep("error");
      setErroredAtStep(phase);
      setMessage((err as Error).message);
    }
  }

  const busy = step === "quoting" || step === "leg1_signing" || step === "leg1_confirming" || step === "leg2_pending";
  const isError = step === "error";
  const isDone = step === "done";

  const stepDefs: SwapStep[] = [
    { key: "quoting", label: "Quote" },
    { key: "leg1_signing", label: "Sign" },
    { key: "leg1_confirming", label: "Confirm" },
    ...(needsRelayLeg2 ? [{ key: "leg2_pending", label: isCrossChain ? "Bridge" : "Swap" }] : []),
    { key: "done", label: "Done" },
  ];
  const currentStepIndex = stepDefs.findIndex((s) => s.key === (isError ? erroredAtStep : step));
  const erroredIndex = isError ? stepDefs.findIndex((s) => s.key === erroredAtStep) : null;

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

      <Reveal className="mx-auto flex w-full max-w-lg flex-col gap-4">
        {/* 2026-08-06 (frontend audit, Impeccable detector: "flat-type-hierarchy")
            — same gap as /nft: no page-level heading at all, straight into
            the widget, so text sizes clustered with nothing bigger to anchor
            a real scale. */}
        <h1 className="font-display px-1 text-2xl font-normal text-ink">Swap</h1>
        <TrendingBar chainId={SOLANA_CHAIN_ID_CLIENT} />

        <SwapPanel
          sellToken={sellToken}
          buyToken={buyToken}
          onSellTokenChange={setSellToken}
          onBuyTokenChange={setBuyToken}
          sellAmount={sellAmount}
          onSellAmountChange={setSellAmount}
          destAddress={destAddress}
          onDestAddressChange={setDestAddress}
          destAddressError={destAddressError}
          isCrossChain={isCrossChain}
          onFlip={flip}
          sellBalance={sellBalance}
          sellBalanceLoading={sellBalanceLoading}
          onPreviewChange={setPreview}
        />

        <SlippageControl bps={slippageBps} onChange={setSlippageBps} />

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

        {step !== "idle" && <SwapStepper steps={stepDefs} currentIndex={currentStepIndex} erroredIndex={erroredIndex} />}

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

        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 self-start text-sm font-medium text-ink-muted transition-colors hover:text-accent"
        >
          View points &amp; referrals
          <span aria-hidden="true">→</span>
        </Link>
      </Reveal>

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
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-faint">Platform fee</span>
                <span className="text-xs text-ink-muted">0.25% per leg</span>
              </div>
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
                runSwap();
              }}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110"
            >
              Confirm swap
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
