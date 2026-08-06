"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useAuth } from "@/lib/client/AuthProvider";
import { roundUpTo3Decimals } from "@/lib/client/amount";
import { magicEdenBuyerTotal } from "@/lib/nft/magicedenFee";
import { NftImage } from "@/app/components/NftImage";
import { EvmWalletButton } from "@/app/components/EvmWalletButton";
import { EvmConnectPicker } from "@/app/components/EvmConnectPicker";
import { EVM_CHAINS, type EvmChainOption } from "@/lib/nft/evmChains";
import type { NftListing } from "@/lib/nft/types";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

// Same-chain (pay with native SOL, one signature — the buyer's own Solana
// wallet pays AND receives) vs cross-chain (pay with ETH, bridged via Relay
// straight to the buyer's own Solana wallet — see
// app/api/nft/purchase/magiceden/quote/route.ts's doc on why this reuses
// Relay/relay_quote rather than Sui's ChangeNOW path: Relay already
// supports Solana as a plain delivery destination). Mirrors
// NftBuyModal.tsx's sol/eth toggle, but inverted: Solana is the NFT's
// native chain here, ETH is the "bring your own chain" option.
type PayWith = "sol" | "eth";

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

// EVM origins offered for the cross-chain "pay with ETH" path — Ethereum,
// Base, Arbitrum (2026-08-03 addition). Pulled from the same EVM_CHAINS
// registry the NFT browse picker and OpenSea buy flow already use (single
// shared source of truth, see lib/nft/evmChains.ts's file comment) rather
// than a second hardcoded list — all three chains are ETH-denominated
// natively, so `originCurrencySymbol` stays "ETH" regardless of which one
// is picked. Must match app/api/nft/purchase/magiceden/quote/route.ts's
// MAGICEDEN_EVM_ORIGIN_CHAIN_IDS allowlist exactly.
const MAGICEDEN_EVM_ORIGIN_SLUGS = ["ethereum", "base", "arbitrum"];
const MAGICEDEN_EVM_ORIGIN_CHAINS: EvmChainOption[] = EVM_CHAINS.filter((c) => MAGICEDEN_EVM_ORIGIN_SLUGS.includes(c.slug));

export function NftBuyModalMagicEden({ listing, onClose }: { listing: NftListing; onClose: () => void }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const auth = useAuth();

  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<PayWith>("sol");
  const [evmOriginChain, setEvmOriginChain] = useState<EvmChainOption>(MAGICEDEN_EVM_ORIGIN_CHAINS[0]);
  const [quote, setQuote] = useState<{
    quoteId: string;
    originAmountFormatted: string;
    originAmountUsd: string;
    originCurrencySymbol: string;
    sameChain: boolean;
  } | null>(null);

  const raw = listing.raw as { pdaAddress: string; auctionHouse: string; seller: string; tokenAddress: string };
  const walletsReady = payWith === "eth" ? Boolean(evmWallet.address && publicKey) : Boolean(publicKey);
  const signedIn =
    payWith === "eth"
      ? Boolean(evmWallet.address && auth.evmVerifiedAddress === evmWallet.address)
      : Boolean(publicKey && auth.sessionPubkey === publicKey.toBase58());
  const readyToQuote = walletsReady && signedIn && Boolean(publicKey);

  async function getQuote() {
    if (!readyToQuote || !publicKey) return;
    setStep("quoting");
    setMessage(null);
    try {
      const res = await fetch("/api/nft/purchase/magiceden/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collectionSlug: listing.collectionSlug,
          tokenId: listing.tokenId,
          pdaAddress: raw.pdaAddress,
          auctionHouse: raw.auctionHouse,
          seller: raw.seller,
          tokenATA: raw.tokenAddress,
          listingPriceSol: listing.price,
          royaltyBps: listing.royaltyBps,
          payWith,
          originChainId: payWith === "eth" ? evmOriginChain.chainId : undefined,
          sourceAddress: payWith === "eth" ? evmWallet.address : undefined,
          destAddress: publicKey.toBase58(),
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
    setStep("depositing");
    setMessage(`Confirm the deposit in your ${evmOriginChain.label} wallet…`);
    try {
      const execRes = await fetch("/api/nft/purchase/magiceden/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to build deposit");

      await evmWallet.ensureChain(evmOriginChain.chainId);
      for (let i = 0; i < execBody.steps.length; i++) {
        const item = execBody.steps[i]?.items?.[0];
        if (!item?.data) throw new Error(`Deposit step "${execBody.steps[i]?.id}" did not include transaction data`);
        await evmWallet.sendStepAndWait(item.data);
      }

      setStep("confirming_deposit");
      setMessage("Deposit submitted — bridging to Solana (usually a few seconds)…");
      await pollDeposit(execBody.purchaseId);
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  // No deposit leg — the buyer already holds SOL, execute() returns a
  // fresh, staleness-checked buy transaction directly. One signature total.
  async function payAndBuySameChain() {
    if (!quote) return;
    setStep("buying");
    setMessage("Confirm the purchase in your Solana wallet…");
    try {
      const execRes = await fetch("/api/nft/purchase/magiceden/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to prepare purchase");
      if (execBody.status === "insufficient_funds") {
        setMessage(
          `This purchase needs ${roundUpTo3Decimals(Number(execBody.requiredSol))} SOL — your wallet has ${roundUpTo3Decimals(Number(execBody.balanceSol))} SOL. Add more SOL and try again.`,
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
      const res = await fetch("/api/nft/purchase/magiceden/confirm-deposit", {
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
        setMessage("This NFT was sold or delisted while your payment was bridging. Your SOL landed safely in your wallet.");
        setStep("listing_gone");
        return;
      }
      if (body.status === "insufficient_funds") {
        setMessage(
          `The bridged amount wasn't enough — this purchase needs ${roundUpTo3Decimals(Number(body.requiredSol))} SOL, your wallet has ${roundUpTo3Decimals(Number(body.balanceSol))} SOL. Your bridged SOL is safely in your wallet — add a bit more and retry the purchase.`,
        );
        setStep("failed");
        return;
      }
      if (body.status === "deposit_confirmed" && body.buyTransaction) {
        setStep("buying");
        setMessage("Confirm the purchase in your Solana wallet…");
        await signAndBuy(id, body.buyTransaction);
        return;
      }
      // still "deposit_pending" — keep polling
    }
    setMessage("This is taking longer than expected — check back shortly, your bridge deposit may still settle.");
    setStep("failed");
  }

  async function signAndBuy(id: string, buyTx: { txSignedBase64: string; blockhash: string; lastValidBlockHeight: number }) {
    if (!signTransaction) return;
    try {
      // Same deserialize convention already used for Jupiter's swap
      // transaction (see app/page.tsx) — Magic Eden's response is a
      // VersionedTransaction, ALREADY partially co-signed (e.g. OCP royalty
      // enforcement), confirmed against
      // docs.magiceden.io/recipes/sol-list-an-nft.md. The wallet adds the
      // buyer's own signature on top; it doesn't need to be the only one.
      const tx = VersionedTransaction.deserialize(Buffer.from(buyTx.txSignedBase64, "base64"));
      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize());

      setStep("confirming_buy");
      setMessage("Confirming your purchase on-chain…");
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await fetch("/api/nft/purchase/magiceden/confirm-buy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purchaseId: id, buyTxSignature: signature }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to confirm purchase");
        if (body.status === "complete") {
          setStep("complete");
          setMessage("Purchase complete — the NFT has been sent to your Solana wallet.");
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
            <span className="truncate text-sm font-medium text-ink">{listing.name ?? `#${listing.tokenId.slice(0, 8)}`}</span>
            <span className="num text-sm font-semibold text-ink">
              {roundUpTo3Decimals(magicEdenBuyerTotal(Number(listing.price), listing.royaltyBps))}{" "}
              <span className="text-ink-muted">{listing.priceCurrency}</span>
            </span>
          </div>
        </div>

        {step === "idle" && (
          <div className="flex rounded-xl bg-surface-hover p-1 text-xs font-medium">
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
          </div>
        )}

        {step === "idle" && payWith === "eth" && (
          <div className="flex gap-1 rounded-xl bg-surface-hover p-1 text-xs font-medium">
            {MAGICEDEN_EVM_ORIGIN_CHAINS.map((chain) => (
              <button
                key={chain.slug}
                onClick={() => setEvmOriginChain(chain)}
                className={`flex-1 rounded-lg py-1.5 transition-colors ${
                  evmOriginChain.slug === chain.slug ? "bg-accent text-accent-ink" : "text-ink-muted"
                }`}
              >
                {chain.label}
              </button>
            ))}
          </div>
        )}

        {!readyToQuote && payWith === "sol" && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">Paying directly in SOL on Solana — connect a Solana wallet and sign in to continue.</p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Solana (pays &amp; receives)</span>
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
          </div>
        )}

        {!readyToQuote && payWith === "eth" && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">
              Paying in ETH on {evmOriginChain.label}, buying a Solana NFT — connect and sign in with both wallets to continue.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">{evmOriginChain.label} (pays)</span>
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
                <EvmConnectPicker desiredChainId={evmOriginChain.chainId} />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Solana (receives &amp; buys)</span>
              {!publicKey ? (
                <WalletMultiButton />
              ) : auth.sessionPubkey === publicKey.toBase58() ? (
                <p className="text-[11px] text-success">Signed in.</p>
              ) : (
                <button
                  onClick={() => auth.signIn()}
                  disabled={auth.signingIn}
                  className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors hover:brightness-110 disabled:opacity-60"
                >
                  {auth.signingIn ? "Signing…" : "Sign in with Solana"}
                </button>
              )}
            </div>
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
              <span className="text-xs text-ink-muted">You pay{!quote.sameChain && ` (on ${evmOriginChain.label})`}</span>
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
