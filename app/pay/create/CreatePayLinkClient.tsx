"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import { TokenSelectModal, type SelectedToken } from "@/app/components/TokenSelectModal";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";

export function CreatePayLinkClient() {
  const { publicKey } = useWallet();
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();

  const [destToken, setDestToken] = useState<SelectedToken | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [destAddress, setDestAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ownAddress = destToken
    ? destToken.chainId === SOLANA_CHAIN_ID_CLIENT
      ? (publicKey?.toBase58() ?? null)
      : (evmWallet.address ?? null)
    : null;

  function useOwnAddress() {
    if (ownAddress) setDestAddress(ownAddress);
  }

  async function create() {
    if (!destToken) {
      setMessage("Pick a token to receive first.");
      return;
    }
    if (!destAddress) {
      setMessage("Enter (or connect) a destination address.");
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destChainId: destToken.chainId,
          destToken: destToken.address,
          destTokenSymbol: destToken.symbol,
          destTokenDecimals: destToken.decimals,
          destTokenLogoUri: destToken.logoURI,
          destAddress,
          amountRequested: amount || undefined,
          label: label || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          connectWalletModal.setOpen(true);
          setMessage("Sign in first, then try again.");
          return;
        }
        throw new Error(body.error ?? "Failed to create link");
      }
      setCreatedUrl(`${window.location.origin}/pay/${body.id}`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (createdUrl) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <AppHeader />
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center">
          <p className="text-2xl">⚡</p>
          <p className="text-sm font-semibold text-ink">Your ClickPay link is ready</p>
          <div className="flex w-full items-center gap-2 rounded-xl border border-hairline bg-surface-hover px-3 py-2">
            <span className="num flex-1 truncate text-sm text-ink">{createdUrl}</span>
            <button
              onClick={() => navigator.clipboard.writeText(createdUrl)}
              className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Share it anywhere — X, Discord, Telegram. Anyone opening it can pay from whatever they hold.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1 px-1">
          <h1 className="font-display text-2xl font-normal text-ink">⚡ Create a ClickPay link</h1>
          <p className="text-sm text-ink-muted">
            Pick what you want to receive — the payer can pay from whatever they hold on any connected chain.
          </p>
        </div>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">You want to receive</p>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-hover px-3 py-2 transition-all hover:border-accent/40"
          >
            {destToken ? (
              <span className="flex items-center gap-2">
                <TokenIcon logoURI={destToken.logoURI} symbol={destToken.symbol} chainIconUrl={destToken.chainIconUrl} size={28} />
                <span className="text-sm font-semibold text-ink">
                  {destToken.symbol} <span className="text-ink-faint">on {destToken.chainDisplayName}</span>
                </span>
              </span>
            ) : (
              <span className="text-sm text-ink-faint">Select token</span>
            )}
            <span className="text-ink-faint">›</span>
          </button>

          <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
            Amount (leave blank for an open/any-amount link)
            <input
              className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
            Label (optional)
            <input
              className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Logo design invoice"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
            Your receiving address {destToken && `on ${destToken.chainDisplayName}`}
            <input
              className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={destAddress}
              onChange={(e) => setDestAddress(e.target.value)}
              placeholder="Paste an address, or connect your wallet"
            />
          </label>
          {ownAddress && destAddress !== ownAddress && (
            <button onClick={useOwnAddress} className="self-start text-xs font-medium text-accent hover:underline">
              Use my connected wallet
            </button>
          )}
        </section>

        <button
          onClick={create}
          disabled={creating}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? "Creating…" : "Create link"}
        </button>

        {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
      </div>

      <TokenSelectModal open={modalOpen} onClose={() => setModalOpen(false)} mode="multi-chain" onSelect={setDestToken} />
    </main>
  );
}
