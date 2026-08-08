"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import { executeQuotedSwap, type SwapFlowPhase } from "@/lib/client/executeSwapFlow";
import { SWAP_CHAINS, SOLANA_SWAP_CHAIN, swapChainForChainId } from "@/lib/chains/swapChains";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";
import type { PaymentLink } from "@/lib/payments/links";

type Step = "idle" | "quoting" | "leg1_signing" | "leg1_confirming" | "leg2_pending" | "done" | "error";

const SOURCE_CHAINS = SWAP_CHAINS; // Solana + the 6 configured EVM chains — native currency only, see app/api/pay/[id]/quote's own doc

export function PayClient({ link }: { link: PaymentLink }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();

  const destChain = swapChainForChainId(link.dest_chain_id);
  const [sourceChainId, setSourceChainId] = useState(SOLANA_CHAIN_ID_CLIENT);
  const [amount, setAmount] = useState(link.amount_requested ?? "");
  const [step, setStep] = useState<Step>("idle");
  const [quote, setQuote] = useState<{ quoteId: string; sourceAmount: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const sourceChain = swapChainForChainId(sourceChainId) ?? SOLANA_SWAP_CHAIN;
  const sourceIsSolana = sourceChainId === SOLANA_CHAIN_ID_CLIENT;
  const walletReady = sourceIsSolana ? Boolean(publicKey) : Boolean(evmWallet.address);
  const isOpenLink = link.amount_requested == null;

  async function getQuote() {
    if (!walletReady) {
      connectWalletModal.setOpen(true);
      return;
    }
    if (isOpenLink && (!amount || Number(amount) <= 0)) {
      setMessage("Enter an amount.");
      return;
    }
    setStep("quoting");
    setMessage(null);
    try {
      const res = await fetch(`/api/pay/${link.id}/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceChainId,
          sourceAddress: sourceIsSolana ? undefined : evmWallet.address,
          amountOverride: isOpenLink ? amount : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Quote failed");
      setQuote(body);
      setStep("idle");
    } catch (err) {
      setMessage((err as Error).message);
      setStep("error");
    }
  }

  async function pay() {
    if (!quote) return;
    setStep("leg1_signing");
    setMessage(null);
    try {
      await executeQuotedSwap(
        { quoteId: quote.quoteId, sourceChainId, destChainId: link.dest_chain_id },
        { solanaPublicKey: publicKey, signSolanaTransaction: signTransaction, connection, evmWallet },
        (phase: SwapFlowPhase, msg?: string) => {
          setStep(phase === "done" ? "done" : (phase as Step));
          if (msg) setMessage(msg);
        },
      );
      setStep("done");
      setMessage("Payment complete.");
    } catch (err) {
      setStep("error");
      setMessage((err as Error).message);
    }
  }

  const busy = step === "quoting" || step === "leg1_signing" || step === "leg1_confirming" || step === "leg2_pending";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">⚡ ClickPay {link.label && `· ${link.label}`}</p>
          <div className="flex items-center gap-3">
            <TokenIcon logoURI={link.dest_token_logo_uri ?? ""} symbol={link.dest_token_symbol} size={36} />
            <div>
              <p className="num text-2xl font-semibold text-ink">
                {link.amount_requested ? `${link.amount_requested} ${link.dest_token_symbol}` : "Any amount"}
              </p>
              <p className="text-xs text-ink-faint">on {destChain?.label ?? `chain ${link.dest_chain_id}`}</p>
            </div>
          </div>
        </section>

        {step === "done" ? (
          <section className="rounded-2xl border border-hairline bg-surface p-5 text-center shadow-sm">
            <p className="text-2xl">✅</p>
            <p className="mt-2 text-sm font-semibold text-ink">Payment complete</p>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Pay with</p>
              <div className="flex flex-wrap gap-2">
                {SOURCE_CHAINS.map((c) => (
                  <button
                    key={c.chainId}
                    onClick={() => {
                      setSourceChainId(c.chainId);
                      setQuote(null);
                    }}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${
                      sourceChainId === c.chainId ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted"
                    }`}
                  >
                    <TokenIcon logoURI={c.iconUrl} symbol={c.label} size={18} />
                    {c.label}
                  </button>
                ))}
              </div>

              {isOpenLink && (
                <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
                  Amount ({link.dest_token_symbol})
                  <input
                    className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setQuote(null);
                    }}
                    placeholder="0.00"
                  />
                </label>
              )}

              {quote && (
                <p className="num rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink">
                  Pay ~{(Number(quote.sourceAmount) / (sourceIsSolana ? 1e9 : 1e18)).toFixed(6)} — {sourceChain.label}&apos;s native
                  currency
                </p>
              )}
            </section>

            <button
              onClick={quote ? pay : getQuote}
              disabled={busy}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {!walletReady ? "Connect wallet" : busy ? "Working…" : quote ? `💳 Pay with ${sourceChain.label}` : "Get quote"}
            </button>

            <p className="text-[11px] leading-relaxed text-ink-faint">
              Funds are delivered directly to the recipient&apos;s own wallet — this app never holds your payment.
            </p>
          </>
        )}

        {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
      </div>
    </main>
  );
}
