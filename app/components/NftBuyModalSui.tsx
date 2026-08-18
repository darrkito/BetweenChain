"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useBtcWallet } from "@/lib/client/BtcWalletProvider";
import { useAuth } from "@/lib/client/AuthProvider";
import { buildSolTransferTransaction } from "@/lib/client/solanaTransfer";
import { roundUpTo3Decimals } from "@/lib/client/amount";
import { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/nft/tradeportFee";
import { NftImage } from "@/app/components/NftImage";
import { EvmWalletButton } from "@/app/components/EvmWalletButton";
import { EvmConnectPicker } from "@/app/components/EvmConnectPicker";
import { SuiConnectPicker } from "@/app/components/SuiConnectPicker";
import { SuiWalletButton } from "@/app/components/SuiWalletButton";
import { BtcConnectPicker } from "@/app/components/BtcConnectPicker";
import type { NftListing } from "@/lib/nft/types";

// styles.css moved here from app/providers.tsx (2026-08-18 perf pass) — see
// that file's comment for why: it carries a render-blocking Google Fonts
// @import that used to load globally even on pages with no WalletMultiButton
// on screen. Co-located with this dynamic import so it only loads in the
// same lazy chunk as the button it styles.
import "@solana/wallet-adapter-react-ui/styles.css";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

// Same-chain (pay with native SUI, one signature) vs cross-chain (pay with
// ETH, SOL, or BTC — added 2026-08-08 — bridged via ChangeNOW since Relay has
// no Sui support — see lib/chains/changenow.ts) — mirrors NftBuyModal.tsx's
// sol/eth toggle, inverted: here Sui is the NFT's native chain and ETH/SOL/
// BTC are "bring your own chain" options, not the other way around.
type PayWith = "sui" | "eth" | "sol" | "btc";

type Step =
  | "idle"
  | "quoting"
  | "quoted"
  | "depositing"
  | "confirming_deposit"
  | "listing_gone"
  | "buying"
  | "confirming_buy"
  | "complete"
  | "failed";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ethereum only for now — same "wired chains" scope as EVM_CHAINS, this is
// the one EVM chain this modal offers as an ETH-origin source. Extend
// alongside evmChains.ts if more EVM origins are wanted here later.
const ETH_ORIGIN_CHAIN_ID = 1;

export function NftBuyModalSui({ listing, onClose }: { listing: NftListing; onClose: () => void }) {
  const suiAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteSuiTransaction } = useSignAndExecuteTransaction();
  const evmWallet = useEvmWallet();
  const btcWallet = useBtcWallet();
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const auth = useAuth();

  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<PayWith>("sui");
  const [quote, setQuote] = useState<{
    quoteId: string;
    originAmountFormatted: string;
    originAmountUsd: string;
    originCurrencySymbol: string;
    sameChain: boolean;
  } | null>(null);

  const raw = listing.raw as { id: string; chain: string; collectionSlug: string };
  // Any session (Solana or EVM sign-in) satisfies requireSession() — Sui has
  // no SIWS/SIWE-equivalent of its own, so a Sui-only wallet can never BE the
  // account identity here, same "Sui wallet is purely a signing/receiving
  // tool" role as the EVM wallet already has elsewhere (see AGENTS.md's
  // "Origins beyond Solana" section). For the ETH/SOL-origin paths
  // specifically, the wallet doing the actual spending must itself be the
  // verified session address — same rule the existing cross-chain ETH flow
  // already enforces.
  const hasAnySession = Boolean(auth.sessionPubkey || auth.evmVerifiedAddress);
  // Bitcoin has no sign-in of its own (same reasoning as Sui — see
  // BtcWalletProvider.tsx's own doc comment), so it only needs the wallet
  // itself connected + the existing Solana/EVM session, not a per-address
  // signed-in check the way eth/sol (which ARE the account identity) do.
  const walletsReady =
    payWith === "eth"
      ? Boolean(evmWallet.address && suiAccount)
      : payWith === "sol"
        ? Boolean(publicKey && suiAccount)
        : payWith === "btc"
          ? Boolean(btcWallet.address && suiAccount)
          : Boolean(suiAccount);
  const signedIn =
    payWith === "eth"
      ? Boolean(evmWallet.address && auth.evmVerifiedAddress === evmWallet.address)
      : payWith === "sol"
        ? Boolean(publicKey && auth.sessionPubkey === publicKey.toBase58())
        : hasAnySession;
  const readyToQuote = walletsReady && signedIn;

  async function getQuote() {
    if (!readyToQuote || !suiAccount) return;
    setStep("quoting");
    setMessage(null);
    try {
      const res = await fetch("/api/nft/purchase/sui/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collectionSlug: raw.collectionSlug,
          tokenId: listing.tokenId,
          listingId: raw.id,
          listingPriceSui: listing.price,
          moveChain: "sui",
          payWith,
          originChainId: payWith === "eth" ? ETH_ORIGIN_CHAIN_ID : undefined,
          sourceAddress: payWith === "eth" ? evmWallet.address : undefined,
          destAddress: suiAccount.address,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to get quote");
      setQuote(body);
      setStep("quoted");
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  async function payAndBuy() {
    if (!quote) return;
    if (quote.sameChain) {
      await payAndBuySameChain();
      return;
    }
    if (payWith === "sol") {
      await payAndBuyFromSol();
      return;
    }
    if (payWith === "btc") {
      await payAndBuyFromBtc();
      return;
    }
    setStep("depositing");
    setMessage("Confirm the deposit in your Ethereum wallet…");
    try {
      const execRes = await fetch("/api/nft/purchase/sui/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to create exchange");

      // A PLAIN native-ETH transfer to ChangeNOW's deposit address — no
      // contract call (unlike Relay/Squid's transactionRequest shape). See
      // lib/chains/changenow.ts's top comment on the trust-model difference
      // this reflects.
      await evmWallet.ensureChain(ETH_ORIGIN_CHAIN_ID);
      await evmWallet.sendStepAndWait({
        from: evmWallet.address!,
        to: execBody.depositAddress,
        data: "0x",
        value: BigInt(Math.round(Number(execBody.depositAmount) * 1e18)).toString(),
        chainId: ETH_ORIGIN_CHAIN_ID,
      });

      setStep("confirming_deposit");
      setMessage("Deposit submitted — bridging to Sui (this can take a few minutes)…");
      await pollDeposit(execBody.purchaseId);
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  // Cross-chain SOL origin: a plain native-SOL transfer to ChangeNOW's
  // deposit address (base58 Solana address), same pattern as the ETH
  // deposit above but signed with the Solana wallet instead.
  async function payAndBuyFromSol() {
    if (!quote || !publicKey || !signTransaction) return;
    setStep("depositing");
    setMessage("Confirm the deposit in your Solana wallet…");
    try {
      const execRes = await fetch("/api/nft/purchase/sui/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to create exchange");

      const depositTx = await buildSolTransferTransaction({
        connection,
        payer: publicKey,
        toAddress: execBody.depositAddress,
        lamports: Math.round(Number(execBody.depositAmount) * 1e9),
      });
      const signed = await signTransaction(depositTx);
      await connection.sendRawTransaction(signed.serialize());

      setStep("confirming_deposit");
      setMessage("Deposit submitted — bridging to Sui (this can take a few minutes)…");
      await pollDeposit(execBody.purchaseId);
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  // Cross-chain BTC origin (2026-08-08) — a plain BTC payment to ChangeNOW's
  // deposit address via sats-connect's real sendTransfer request. Simpler
  // than the ETH/SOL paths above: BtcWalletProvider.tsx's sendPayment
  // already handles the whole send (no manual transaction construction
  // needed here, unlike buildSolTransferTransaction/evmWallet.sendStepAndWait).
  async function payAndBuyFromBtc() {
    if (!quote) return;
    setStep("depositing");
    setMessage("Confirm the payment in your Bitcoin wallet…");
    try {
      const execRes = await fetch("/api/nft/purchase/sui/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to create exchange");

      await btcWallet.sendPayment(execBody.depositAddress, Number(execBody.depositAmount));

      setStep("confirming_deposit");
      setMessage("Payment submitted — bridging to Sui (this can take a few minutes)…");
      await pollDeposit(execBody.purchaseId);
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  // Same-chain: no deposit leg — buyer already holds SUI, execute() returns
  // a fresh buy transaction directly. One signature total.
  async function payAndBuySameChain() {
    if (!quote) return;
    setStep("buying");
    setMessage("Confirm the purchase in your Sui wallet…");
    try {
      const execRes = await fetch("/api/nft/purchase/sui/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to prepare purchase");
      if (execBody.status === "listing_gone") {
        setMessage("This NFT was sold or delisted just now — you were not charged.");
        setStep("listing_gone");
        return;
      }
      if (execBody.status === "insufficient_funds") {
        setMessage(
          `This purchase needs ${roundUpTo3Decimals(Number(execBody.requiredSui))} SUI — your wallet has ${roundUpTo3Decimals(Number(execBody.balanceSui))} SUI. Add more SUI and try again.`,
        );
        setStep("failed");
        return;
      }
      if (!execBody.buyTransaction) throw new Error("Purchase step did not include a buy transaction");
      await signAndBuy(execBody.purchaseId, execBody.buyTransaction);
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  async function pollDeposit(id: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(5000);
      const res = await fetch("/api/nft/purchase/sui/confirm-deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purchaseId: id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to confirm deposit");

      if (body.status === "failed") {
        setMessage("The bridge deposit did not settle. Safe to retry.");
        setStep("failed");
        return;
      }
      if (body.status === "listing_gone") {
        setMessage("This NFT was sold or delisted while your payment was bridging. Your SUI landed safely in your wallet.");
        setStep("listing_gone");
        return;
      }
      if (body.status === "insufficient_funds") {
        setMessage(
          `The bridged amount wasn't enough — this purchase needs ${roundUpTo3Decimals(Number(body.requiredSui))} SUI, your wallet has ${roundUpTo3Decimals(Number(body.balanceSui))} SUI. Your bridged SUI is safely in your wallet — add a bit more and retry the purchase.`,
        );
        setStep("failed");
        return;
      }
      if (body.status === "deposit_confirmed" && body.buyTransaction) {
        setStep("buying");
        setMessage("Confirm the purchase in your Sui wallet…");
        await signAndBuy(id, body.buyTransaction);
        return;
      }
      // still "deposit_pending" — keep polling
    }
    setMessage("This is taking longer than expected — check back shortly, your bridge deposit may still settle.");
    setStep("failed");
  }

  async function signAndBuy(id: string, serializedTx: string) {
    try {
      const tx = Transaction.from(serializedTx);
      const result = await signAndExecuteSuiTransaction({ transaction: tx });

      setStep("confirming_buy");
      setMessage("Confirming your purchase on-chain…");
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await fetch("/api/nft/purchase/sui/confirm-buy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purchaseId: id, buyTxDigest: result.digest }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to confirm purchase");
        if (body.status === "complete") {
          setStep("complete");
          setMessage("Purchase complete — the NFT has been sent to your Sui wallet.");
          return;
        }
        if (body.status === "failed") {
          setStep("failed");
          setMessage("The purchase transaction failed on-chain.");
          return;
        }
        await sleep(3000);
      }
      setMessage("Still confirming — check your wallet's transaction history shortly.");
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  const busy = ["quoting", "depositing", "confirming_deposit", "buying", "confirming_buy"].includes(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-2xl border border-hairline bg-surface p-5 shadow-xl"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <NftImage src={listing.imageUrl ?? ""} alt={listing.name ?? listing.tokenId} className="h-14 w-14 shrink-0 rounded-xl" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-ink">{listing.name ?? `#${listing.tokenId}`}</span>
            <span className="num text-sm font-semibold text-ink">
              {roundUpTo3Decimals(Number(listing.price) * (1 + TRADEPORT_FEE_SAFETY_MARGIN))}{" "}
              <span className="text-ink-muted">{listing.priceCurrency}</span>
            </span>
          </div>
        </div>

        {step === "idle" && (
          <div className="flex rounded-xl bg-surface-hover p-1 text-xs font-medium">
            <button
              onClick={() => setPayWith("sui")}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${payWith === "sui" ? "bg-accent text-accent-ink" : "text-ink-muted"}`}
            >
              Pay with SUI
            </button>
            <button
              onClick={() => setPayWith("sol")}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${payWith === "sol" ? "bg-accent text-accent-ink" : "text-ink-muted"}`}
            >
              Pay with SOL
            </button>
            <button
              onClick={() => setPayWith("eth")}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${payWith === "eth" ? "bg-accent text-accent-ink" : "text-ink-muted"}`}
            >
              Pay with ETH
            </button>
            <button
              onClick={() => setPayWith("btc")}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${payWith === "btc" ? "bg-accent text-accent-ink" : "text-ink-muted"}`}
            >
              Pay with BTC
            </button>
          </div>
        )}

        {!readyToQuote && payWith === "sui" && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">Paying directly in SUI on Sui — connect a Sui wallet and sign in to this app.</p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Sui (pays &amp; receives)</span>
              {suiAccount ? <SuiWalletButton address={suiAccount.address} /> : <SuiConnectPicker />}
            </div>
            {!hasAnySession && (
              <p className="text-[11px] text-ink-faint">
                Sign in with Solana or Ethereum elsewhere in the app first — Sui has no sign-in of its own, it&apos;s only used here to pay
                and receive the NFT.
              </p>
            )}
          </div>
        )}

        {!readyToQuote && payWith === "sol" && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">
              Paying in SOL from Solana, buying a Sui NFT — connect and sign in with both wallets to continue.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Solana (pays)</span>
              {!publicKey ? (
                <WalletMultiButton />
              ) : auth.sessionPubkey === publicKey.toBase58() ? (
                <p className="text-[11px] text-success">Signed in.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => auth.signIn()}
                    disabled={auth.signingIn}
                    className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors hover:brightness-110 disabled:opacity-60"
                  >
                    {auth.signingIn ? "Signing…" : "Sign in with Solana"}
                  </button>
                  {auth.error && <p className="text-[11px] text-danger">{auth.error}</p>}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Sui (receives &amp; buys)</span>
              {suiAccount ? <SuiWalletButton address={suiAccount.address} /> : <SuiConnectPicker />}
            </div>
          </div>
        )}

        {!readyToQuote && payWith === "eth" && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">
              Paying in ETH on Ethereum, buying a Sui NFT — connect and sign in with both wallets to continue.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Ethereum (pays)</span>
              {evmWallet.address ? (
                auth.evmVerifiedAddress === evmWallet.address ? (
                  <p className="text-[11px] text-success">Signed in.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    <EvmWalletButton address={evmWallet.address} connecting={false} error={null} onConnect={() => {}} />
                    <button
                      onClick={() => auth.signInEvm(evmWallet.address!)}
                      disabled={auth.signingInEvm}
                      className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors hover:brightness-110 disabled:opacity-60"
                    >
                      {auth.signingInEvm ? "Signing…" : "Sign in with Ethereum"}
                    </button>
                    {auth.evmError && <p className="text-[11px] text-danger">{auth.evmError}</p>}
                  </div>
                )
              ) : (
                <EvmConnectPicker />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Sui (receives &amp; buys)</span>
              {suiAccount ? <SuiWalletButton address={suiAccount.address} /> : <SuiConnectPicker />}
            </div>
          </div>
        )}

        {!readyToQuote && payWith === "btc" && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">Paying in BTC on Bitcoin, buying a Sui NFT — connect a Bitcoin wallet to continue.</p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Bitcoin (pays)</span>
              {btcWallet.address ? (
                <p className="num text-[11px] text-success">
                  {btcWallet.address.slice(0, 6)}…{btcWallet.address.slice(-4)} connected
                </p>
              ) : (
                <BtcConnectPicker />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Sui (receives &amp; buys)</span>
              {suiAccount ? <SuiWalletButton address={suiAccount.address} /> : <SuiConnectPicker />}
            </div>
            {!hasAnySession && (
              <p className="text-[11px] text-ink-faint">
                Sign in with Solana or Ethereum elsewhere in the app first — Bitcoin has no sign-in of its own, it&apos;s only used here to
                pay.
              </p>
            )}
          </div>
        )}

        {readyToQuote && (step === "idle" || step === "quoting") && (
          <button
            onClick={getQuote}
            disabled={busy}
            className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {step === "quoting" ? "Getting quote…" : "Get quote"}
          </button>
        )}

        {step === "quoted" && quote && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-xl bg-surface-hover px-3 py-2">
              <span className="text-xs text-ink-muted">You pay</span>
              <span className="num text-sm font-semibold text-ink">
                {roundUpTo3Decimals(Number(quote.originAmountFormatted))} {quote.originCurrencySymbol}{" "}
                <span className="text-ink-faint">(${Number(quote.originAmountUsd).toFixed(2)})</span>
              </span>
            </div>
            <button
              onClick={payAndBuy}
              className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition-all hover:brightness-110"
            >
              Pay &amp; buy
            </button>
          </div>
        )}

        {busy && step !== "quoting" && (
          <p className="rounded-xl bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>
        )}

        {step === "complete" && (
          <p className="rounded-xl border border-success-soft bg-success-soft px-3 py-2 text-sm text-success">{message}</p>
        )}
        {(step === "failed" || step === "listing_gone") && (
          <p className="rounded-xl border border-danger-soft bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>
        )}

        <button onClick={onClose} className="self-center text-xs text-ink-faint hover:text-ink-muted">
          Close
        </button>
      </div>
    </div>
  );
}
