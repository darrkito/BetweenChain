"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildRelayDepositTransaction } from "@/lib/client/relayTransaction";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useAuth } from "@/lib/client/AuthProvider";
import { SOLANA_CHAIN_ID_CLIENT, RELAY_NATIVE_SOL_SENTINEL, RELAY_NATIVE_EVM_SENTINEL } from "@/lib/client/constants";
import { NftImage } from "@/app/components/NftImage";
import { EvmWalletButton } from "@/app/components/EvmWalletButton";
import { EvmConnectPicker } from "@/app/components/EvmConnectPicker";
import { evmChainForSlug } from "@/lib/nft/evmChains";
import type { NftListing } from "@/lib/nft/types";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

// V1 scope: cross-chain origin is always native SOL on Solana — matches the
// exact path already live-verified end-to-end in STATE.md 2026-07-20o. An
// arbitrary origin-chain/token picker (mirroring SwapPanel's Sell side) is a
// real, larger follow-up, not built here. Same-chain (pay in native ETH
// directly on the NFT's own chain, added 2026-07-21) is the other supported
// option — see app/api/nft/purchase/quote/route.ts's isSameChain branch.
// The destination EVM chain is now the LISTING's own chain (lib/nft/evmChains.ts),
// not a hardcoded Ethereum-only id — Base added 2026-07-21.
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

export function NftBuyModal({ listing, onClose }: { listing: NftListing; onClose: () => void }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const auth = useAuth();

  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<PayWith>("sol");
  const [quote, setQuote] = useState<{
    quoteId: string;
    originAmountFormatted: string;
    originAmountUsd: string;
    sameChain: boolean;
  } | null>(null);

  const raw = listing.raw as { order_hash: string; chain: string; protocol_address: string };
  // The listing's own chain — drives which numeric chain id the buyer's
  // wallet must switch to and pay on. Falls back to Ethereum's id only if
  // this listing's chain somehow isn't in the registry (shouldn't happen —
  // browse/listings only ever surface chains from lib/nft/evmChains.ts).
  const buyChain = evmChainForSlug(raw.chain);
  const evmBuyChainId = buyChain?.chainId ?? 1;
  // Same-chain is only meaningful when the NFT's own chain is one this app
  // can also pay from directly (i.e. it's in the registry at all).
  const sameChainAvailable = Boolean(buyChain);
  const walletsReady = payWith === "eth" ? Boolean(evmWallet.address) : Boolean(publicKey && evmWallet.address);
  // The wallet actually paying must be a real, SIWS/SIWE-verified session —
  // /api/nft/purchase/quote requires a session either way, and specifically
  // a Solana one for the "sol" origin (see its isSolanaOrigin check). The
  // receiving-only wallet in the "sol" path (Ethereum, destAddress) doesn't
  // need its own sign-in — it's just where the NFT lands, not a signer.
  const signedIn =
    payWith === "eth"
      ? Boolean(evmWallet.address && auth.evmVerifiedAddress === evmWallet.address)
      : Boolean(publicKey && auth.sessionPubkey === publicKey.toBase58());
  const readyToQuote = walletsReady && signedIn;

  async function getQuote() {
    if (!readyToQuote) return;
    setStep("quoting");
    setMessage(null);
    try {
      const res = await fetch("/api/nft/purchase/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collectionSlug: listing.collectionSlug,
          tokenId: listing.tokenId,
          orderHash: raw.order_hash,
          chainSlug: raw.chain,
          protocolAddress: raw.protocol_address,
          originChainId: payWith === "eth" ? evmBuyChainId : SOLANA_CHAIN_ID_CLIENT,
          originCurrency: payWith === "eth" ? RELAY_NATIVE_EVM_SENTINEL : RELAY_NATIVE_SOL_SENTINEL,
          destAddress: evmWallet.address,
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
    if (!publicKey || !signTransaction) return;
    setStep("depositing");
    setMessage("Confirm the deposit in your Solana wallet…");
    try {
      const execRes = await fetch("/api/nft/purchase/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const execBody = await execRes.json();
      if (!execRes.ok) throw new Error(execBody.error ?? "Failed to build deposit");

      const depositItem = execBody.steps?.[0]?.items?.[0];
      if (!depositItem?.data?.instructions) throw new Error("Deposit step did not include instructions");
      const depositTx = await buildRelayDepositTransaction({
        connection,
        payer: publicKey,
        instructions: depositItem.data.instructions,
        addressLookupTableAddresses: depositItem.data.addressLookupTableAddresses,
      });
      const signed = await signTransaction(depositTx);
      await connection.sendRawTransaction(signed.serialize());

      setStep("confirming_deposit");
      setMessage("Deposit submitted — waiting for it to settle (usually a few seconds)…");
      await pollDeposit(execBody.purchaseId);
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  // No deposit leg at all — the buyer already holds ETH on the NFT's own
  // chain, so execute() returns a fresh, staleness-checked buy call directly
  // instead of a Relay deposit step. One signature total.
  async function payAndBuySameChain() {
    if (!quote) return;
    setStep("buying");
    setMessage("Confirm the purchase in your EVM wallet…");
    try {
      const execRes = await fetch("/api/nft/purchase/execute", {
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
      if (!execBody.buyCall) throw new Error("Purchase step did not include a buy call");
      await signAndBuy(execBody.purchaseId, execBody.buyCall);
    } catch (err) {
      setMessage((err as Error).message);
      setStep("failed");
    }
  }

  async function pollDeposit(id: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(3000);
      const res = await fetch("/api/nft/purchase/confirm-deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purchaseId: id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to confirm deposit");

      if (body.status === "failed") {
        setMessage("The deposit did not settle. Your funds were not moved — safe to retry.");
        setStep("failed");
        return;
      }
      if (body.status === "listing_gone") {
        setMessage("This NFT was sold or delisted while your payment was settling. Your ETH is safely in your wallet.");
        setStep("listing_gone");
        return;
      }
      if (body.status === "deposit_confirmed" && body.buyCall) {
        setStep("buying");
        setMessage("Confirm the purchase in your EVM wallet…");
        await signAndBuy(id, body.buyCall);
        return;
      }
      // still "deposit_pending" — keep polling
    }
    setMessage("This is taking longer than expected — check back shortly, your deposit may still settle.");
    setStep("failed");
  }

  async function signAndBuy(id: string, call: { to: string; value: string; data: string }) {
    try {
      await evmWallet.ensureChain(evmBuyChainId);
      const txHash = await evmWallet.sendStepAndWait({
        from: evmWallet.address!,
        to: call.to,
        data: call.data,
        value: call.value,
        chainId: evmBuyChainId,
      });

      setStep("confirming_buy");
      setMessage("Confirming your purchase on-chain…");
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await fetch("/api/nft/purchase/confirm-buy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purchaseId: id, buyTxHash: txHash }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to confirm purchase");
        if (body.status === "complete") {
          setStep("complete");
          setMessage("Purchase complete — the NFT has been sent to your wallet.");
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
              {Number(listing.price).toFixed(3)} <span className="text-ink-muted">{listing.priceCurrency}</span>
            </span>
          </div>
        </div>

        {sameChainAvailable && step === "idle" && (
          <div className="flex rounded-xl border border-hairline bg-surface-hover p-1 text-xs font-medium">
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

        {!readyToQuote && payWith === "sol" && (
          <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">
              Paying in SOL from Solana, buying an Ethereum NFT — connect and sign in with both wallets to continue.
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
              <span className="text-xs text-ink-faint">Ethereum (receives)</span>
              {evmWallet.address ? (
                <EvmWalletButton address={evmWallet.address} connecting={false} error={null} onConnect={() => {}} />
              ) : (
                <EvmConnectPicker />
              )}
            </div>
          </div>
        )}

        {!readyToQuote && payWith === "eth" && (
          <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-hover p-3">
            <p className="text-xs text-ink-muted">Paying directly in ETH on Ethereum — connect and sign in, one wallet.</p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Ethereum (pays &amp; receives)</span>
              {!evmWallet.address ? (
                <EvmConnectPicker />
              ) : auth.evmVerifiedAddress === evmWallet.address ? (
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
            <div className="flex items-center justify-between rounded-xl border border-hairline bg-surface-hover px-3 py-2">
              <span className="text-xs text-ink-muted">You pay</span>
              <span className="num text-sm font-semibold text-ink">
                {Number(quote.originAmountFormatted).toFixed(3)} {quote.sameChain ? "ETH" : "SOL"}{" "}
                <span className="text-ink-faint">(${Number(quote.originAmountUsd).toFixed(2)})</span>
              </span>
            </div>
            <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
              Includes the {Number(listing.price).toFixed(3)} {listing.priceCurrency} listing price (the marketplace fee is already
              included in that price, same as buying directly), plus network gas for the on-chain purchase
              {quote.sameChain ? "." : " and a 0.25% cross-chain fee for converting and delivering your payment."}
            </p>
            <button
              onClick={payAndBuy}
              className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition-all hover:brightness-110"
            >
              Pay &amp; buy
            </button>
          </div>
        )}

        {busy && step !== "quoting" && (
          <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>
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
