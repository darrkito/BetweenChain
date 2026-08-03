"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SOLANA_CHAIN_ID_CLIENT, normalizeSolanaSourceMint } from "@/lib/client/constants";
import { toAtomicAmount } from "@/lib/client/amount";
import { buildRelayDepositTransaction } from "@/lib/client/relayTransaction";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useSolanaBalance } from "@/lib/client/useSolanaBalance";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { AppHeader } from "@/app/components/AppHeader";
import { TrendingBar } from "@/app/components/TrendingBar";
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

export default function SwapPage() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [sellToken, setSellToken] = useState<SelectedToken | null>(null);
  const [buyToken, setBuyToken] = useState<SelectedToken | null>(null);
  const [sellAmount, setSellAmount] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [slippageBps, setSlippageBps] = useState(100); // 1% default, was hardcoded with no UI control before 2026-08-03
  const [reviewOpen, setReviewOpen] = useState(false);

  const [step, setStep] = useState<Step>("idle");
  const [erroredAtStep, setErroredAtStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [swapId, setSwapId] = useState<string | null>(null);

  const evmWallet = useEvmWallet();

  // Meaningful in both directions now that Sell isn't Solana-only — see
  // STATE.md 2026-07-18i.
  const isCrossChain = sellToken !== null && buyToken !== null && sellToken.chainId !== buyToken.chainId;

  // Solana-only for now (see useSolanaBalance's own comment) — null/ignored
  // for a non-Solana sell token, which SwapPanel treats as "don't show a
  // balance row" rather than a misleading "0".
  const sellIsSolanaForBalance = sellToken?.chainId === SOLANA_CHAIN_ID_CLIENT;
  const { balance: sellBalance, loading: sellBalanceLoading } = useSolanaBalance(
    connection,
    sellIsSolanaForBalance ? publicKey : null,
    sellIsSolanaForBalance && sellToken ? { address: sellToken.address, decimals: sellToken.decimals, isNative: sellToken.isNative } : null,
  );

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
  const canOpenReview =
    Boolean(publicKey && sellToken && buyToken && hasValidInput) &&
    (!isCrossChain || (Boolean(destAddress) && !destAddressError)) &&
    step === "idle";

  async function runSwap() {
    if (!publicKey || !signTransaction || !sellToken || !buyToken) {
      setMessage("Connect a Solana wallet and pick both tokens first.");
      return;
    }
    const sellIsSolana = sellToken.chainId === SOLANA_CHAIN_ID_CLIENT;
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
          destChainId: isCrossChain ? buyToken.chainId : SOLANA_CHAIN_ID_CLIENT,
          destToken: isCrossChain ? buyToken.address : "SOL",
          destAddress: isCrossChain ? destAddress : publicKey.toBase58(),
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
        const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTransaction, "base64"));
        const signed = await signTransaction(tx);
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

      if (isCrossChain) {
        phase = "leg2_pending";
        setStep(phase);
        setMessage("Preparing bridge deposit…");
        const bridgeRes = await fetch("/api/bridge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ swapId: newSwapId }),
        });
        if (!bridgeRes.ok) throw new Error((await bridgeRes.json()).error ?? "Bridge init failed");
        const { steps } = await bridgeRes.json();

        if (sellIsSolana) {
          // This "deposit" step is a Solana transaction even though it
          // bridges to another chain — same connected Solana wallet, no
          // EVM signature needed. See lib/chains/relay.ts.
          const depositItem = steps?.[0]?.items?.[0];
          if (!depositItem?.data?.instructions) {
            throw new Error("Bridge step did not include deposit instructions");
          }

          setMessage("Confirm the bridge deposit transaction in your wallet…");
          const depositTx = await buildRelayDepositTransaction({
            connection,
            payer: publicKey,
            instructions: depositItem.data.instructions,
            addressLookupTableAddresses: depositItem.data.addressLookupTableAddresses,
          });
          const signedDeposit = await signTransaction(depositTx);
          await connection.sendRawTransaction(signedDeposit.serialize());
        } else {
          // Non-Solana origin: one or more real EVM transactions — an ERC20
          // origin returns a separate leading "approve" step before
          // "deposit"; a native-currency origin (ETH, MATIC, ...) returns
          // just "deposit". Iterate whatever comes back, in order, waiting
          // for each to confirm before sending the next. See STATE.md
          // 2026-07-18i and lib/client/useEvmWallet.ts.
          await evmWallet.ensureChain(sellToken.chainId);
          for (let i = 0; i < steps.length; i++) {
            const item = steps[i]?.items?.[0];
            if (!item?.data) throw new Error(`Bridge step "${steps[i]?.id}" did not include transaction data`);
            const label = steps[i].id === "approve" ? "Approve token spend" : "Confirm deposit";
            setMessage(`Step ${i + 1} of ${steps.length}: ${label} in your wallet…`);
            await evmWallet.sendStepAndWait(item.data);
          }
        }

        setMessage("Deposit submitted — waiting for the bridge to settle (usually a few seconds)…");
        for (let attempt = 0; attempt < 40; attempt++) {
          await sleep(3000);
          const confirmRes = await fetch("/api/bridge/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ swapId: newSwapId }),
          });
          if (!confirmRes.ok) throw new Error((await confirmRes.json()).error ?? "Bridge confirm failed");
          const confirmed = await confirmRes.json();
          if (confirmed.status === "complete") {
            setStep("done");
            setMessage("Swap complete.");
            return;
          }
          if (confirmed.status === "leg2_failed") {
            throw new Error(
              sellIsSolana
                ? "Bridge settlement failed — funds remain as SOL in your wallet, safe to retry."
                : "Bridge settlement failed — your deposit did not complete, safe to retry.",
            );
          }
        }
        throw new Error("Bridge is taking longer than expected — check back shortly, it may still settle.");
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
    ...(isCrossChain ? [{ key: "leg2_pending", label: "Bridge" }] : []),
    { key: "done", label: "Done" },
  ];
  const currentStepIndex = stepDefs.findIndex((s) => s.key === (isError ? erroredAtStep : step));
  const erroredIndex = isError ? stepDefs.findIndex((s) => s.key === erroredAtStep) : null;

  function handleMainButtonClick() {
    if (!publicKey) return; // button is a plain label in this state, ConnectWalletMenu lives in the header
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
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
      <AppHeader />

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
        sellBalance={sellIsSolanaForBalance ? sellBalance : null}
        sellBalanceLoading={sellIsSolanaForBalance && sellBalanceLoading}
      />

      <SlippageControl bps={slippageBps} onChange={setSlippageBps} />

      <button
        onClick={handleMainButtonClick}
        disabled={!publicKey || busy || (!canOpenReview && step === "idle")}
        className="rounded-2xl bg-accent px-4 py-3.5 text-[15px] font-semibold text-accent-ink shadow-sm transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!publicKey ? "Connect wallet" : busy ? "Working…" : isError ? "Try again" : isDone ? "Swap again" : "Review swap"}
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
                  {buyToken.symbol} <span className="text-ink-faint">({buyToken.chainDisplayName})</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-faint">Slippage tolerance</span>
                <span className="num text-sm text-ink">{slippageBps / 100}%</span>
              </div>
              {isCrossChain && (
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-xs text-ink-faint">Destination</span>
                  <span className="num truncate text-xs text-ink" title={destAddress}>
                    {destAddress}
                  </span>
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
