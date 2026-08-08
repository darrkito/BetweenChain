"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useBtcWallet } from "@/lib/client/BtcWalletProvider";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { toAtomicAmount } from "@/lib/client/amount";

type Direction = "receive_btc" | "send_btc";
type CounterCurrency = "sol" | "eth";
type Step = "idle" | "quoting" | "quoted" | "depositing" | "confirming" | "done" | "error";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * General BTC<->SOL/ETH swap (2026-08-08, Phase 2 of BTC support) — a
 * deliberately self-contained widget rather than a new branch inside
 * SwapPanel.tsx's generic multi-chain token picker. ChangeNOW's custodial
 * deposit-address execution model has no signable "leg 1" transaction the
 * way Jupiter/Relay do (see app/api/quote/btc/route.ts's doc), so it
 * doesn't fit that component's step model — bolting it on there would risk
 * regressing the highest-traffic page in this app. Same "type the amount
 * you want to RECEIVE" shape as the Sui NFT-purchase BTC flow, for the same
 * reason (only ChangeNOW's "reverse" estimate mode has been live-verified
 * in this codebase).
 */
export function BtcSwapPanel() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const btcWallet = useBtcWallet();
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();

  const [direction, setDirection] = useState<Direction>("receive_btc");
  const [counterCurrency, setCounterCurrency] = useState<CounterCurrency>("sol");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [quote, setQuote] = useState<{ quoteId: string; fromCurrency: string; fromAmount: string; toCurrency: string; toAmount: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const receivedCurrency = direction === "receive_btc" ? "btc" : counterCurrency;
  const sentCurrency = direction === "receive_btc" ? counterCurrency : "btc";

  function destAddressFor(currency: string): string | null {
    if (currency === "btc") return btcWallet.address;
    if (currency === "sol") return publicKey?.toBase58() ?? null;
    return evmWallet.address;
  }

  async function getQuote() {
    const destAddress = destAddressFor(receivedCurrency);
    if (!destAddress) {
      setMessage(
        receivedCurrency === "btc" ? "Connect a Bitcoin wallet first." : receivedCurrency === "sol" ? "Connect a Solana wallet first." : "Connect an EVM wallet first.",
      );
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setMessage("Enter an amount.");
      return;
    }
    setStep("quoting");
    setMessage(null);
    try {
      const res = await fetch("/api/quote/btc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction, counterCurrency, amount, destAddress }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Quote failed");
      setQuote(body);
      setStep("quoted");
    } catch (err) {
      setMessage((err as Error).message);
      setStep("error");
    }
  }

  async function payAndSwap() {
    if (!quote) return;
    setStep("depositing");
    setMessage("Creating exchange…");
    try {
      const execRes = await fetch("/api/swap/btc/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to create exchange");

      setMessage(`Confirm the ${sentCurrency.toUpperCase()} payment in your wallet…`);
      if (execBody.depositCurrency === "btc") {
        await btcWallet.sendPayment(execBody.depositAddress, Number(execBody.depositAmount));
      } else if (execBody.depositCurrency === "sol") {
        if (!publicKey || !signTransaction) throw new Error("Solana wallet required to send this payment.");
        const lamports = Math.round(Number(execBody.depositAmount) * 1e9);
        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash }).add(
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(execBody.depositAddress), lamports }),
        );
        const signed = await signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, "confirmed");
      } else {
        if (!evmWallet.address) throw new Error("EVM wallet required to send this payment.");
        const weiAmount = toAtomicAmount(execBody.depositAmount, 18);
        await evmWallet.sendStepAndWait({ from: evmWallet.address, to: execBody.depositAddress, data: "0x", value: weiAmount, chainId: 1 });
      }

      setStep("confirming");
      setMessage("Payment sent — waiting for ChangeNOW to settle (this can take a few minutes)…");
      for (let attempt = 0; attempt < 60; attempt++) {
        await sleep(5000);
        const confirmRes = await fetch("/api/swap/btc/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ swapId: execBody.swapId }),
        });
        const confirmBody = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirmBody.error ?? "Confirm failed");
        if (confirmBody.status === "complete") {
          setStep("done");
          setMessage("Swap complete.");
          return;
        }
        if (confirmBody.status === "leg1_failed") throw new Error("Exchange failed — safe to retry, contact support if funds were sent.");
      }
      throw new Error("Taking longer than expected — check back shortly, it may still settle.");
    } catch (err) {
      setMessage((err as Error).message);
      setStep("error");
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-ink">₿ Swap with Bitcoin</p>
        <p className="text-xs text-ink-faint">
          BTC ↔ SOL/ETH via a custodial exchange partner — a different trust model from the rest of this app&apos;s
          on-chain swaps. Deposit address is shown after you confirm.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setDirection("receive_btc")}
          className={`flex-1 rounded-full border px-3 py-1.5 text-sm font-semibold transition-all ${direction === "receive_btc" ? "border-accent bg-accent text-accent-ink" : "border-hairline text-ink-muted"}`}
        >
          Buy BTC
        </button>
        <button
          onClick={() => setDirection("send_btc")}
          className={`flex-1 rounded-full border px-3 py-1.5 text-sm font-semibold transition-all ${direction === "send_btc" ? "border-accent bg-accent text-accent-ink" : "border-hairline text-ink-muted"}`}
        >
          Sell BTC
        </button>
      </div>

      <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
        Pay with
        <select
          value={counterCurrency}
          onChange={(e) => setCounterCurrency(e.target.value as CounterCurrency)}
          disabled={direction === "send_btc"}
          className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="sol">SOL</option>
          <option value="eth">ETH</option>
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
        Amount to receive ({receivedCurrency.toUpperCase()})
        <input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setQuote(null);
            setStep("idle");
          }}
          placeholder="0.00"
          className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </label>

      {!btcWallet.address && receivedCurrency === "btc" && (
        <button onClick={() => connectWalletModal.setOpen(true)} className="self-start text-sm font-semibold text-accent hover:underline">
          Connect Bitcoin wallet
        </button>
      )}

      {quote && step === "quoted" && (
        <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink">
          Send ~{quote.fromAmount} {quote.fromCurrency.toUpperCase()} → receive {quote.toAmount} {quote.toCurrency.toUpperCase()}
        </p>
      )}

      {step === "idle" || step === "error" ? (
        <button
          onClick={getQuote}
          className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
        >
          Get quote
        </button>
      ) : step === "quoting" ? (
        <p className="text-sm text-ink-faint">Quoting…</p>
      ) : step === "quoted" ? (
        <button
          onClick={payAndSwap}
          className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
        >
          Confirm & pay
        </button>
      ) : step === "done" ? (
        <button
          onClick={() => {
            setStep("idle");
            setQuote(null);
            setAmount("");
          }}
          className="self-start rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-semibold text-accent transition-all hover:border-accent/40"
        >
          Swap again
        </button>
      ) : (
        <p className="text-sm text-ink-faint">Working…</p>
      )}

      {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
    </section>
  );
}
