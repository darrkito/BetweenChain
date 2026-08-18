"use client";

import { useState } from "react";
import { useSuiWallet } from "@/lib/client/SuiWalletProvider";

/**
 * Lists every real Wallet-Standard-announced Sui wallet (Sui Wallet, Phantom's
 * Sui support, Suiet, …) by name — same shape/reasoning as EvmConnectPicker.tsx
 * for EIP-6963. Wallet Standard is a cross-chain-agnostic protocol (Solana's
 * `wallets={[]}` auto-detection in app/providers.tsx uses the exact same
 * underlying standard) — lib/client/SuiWalletProvider.tsx does its own
 * discovery directly on @mysten/wallet-standard now (2026-08-18, replacing
 * @mysten/dapp-kit's useWallets/useConnectWallet — see that file's doc for
 * why), same shape as before from this component's perspective.
 */
export function SuiConnectPicker() {
  const { wallets, connect, connecting } = useSuiWallet();
  const [error, setError] = useState<string | null>(null);
  const [clickedName, setClickedName] = useState<string | null>(null);

  async function pick(name: string) {
    setError(null);
    setClickedName(name);
    const address = await connect(name);
    if (!address) setError(`Couldn't connect ${name}.`);
  }

  if (wallets.length === 0) {
    return <p className="px-2 text-xs text-ink-faint">No Sui wallet detected — install Sui Wallet or Phantom.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {wallets.map((w) => (
        <button
          key={w.name}
          onClick={() => pick(w.name)}
          disabled={connecting}
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          {w.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- Wallet Standard icons are data: URIs the extension itself provides
            <img src={w.icon} alt="" className="h-5 w-5 shrink-0 rounded" />
          ) : (
            <span className="h-5 w-5 shrink-0 rounded bg-surface-hover" />
          )}
          <span className="truncate">{connecting && clickedName === w.name ? "Connecting…" : w.name}</span>
        </button>
      ))}
      {error && <p className="px-2 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
