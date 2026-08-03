"use client";

import { useDisconnectWallet } from "@mysten/dapp-kit";

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Mirrors EvmWalletButton.tsx's shape/style, Sui side. */
export function SuiWalletButton({ address }: { address: string }) {
  const { mutate: disconnect } = useDisconnectWallet();
  return (
    <button
      onClick={() => disconnect()}
      className="num rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-accent shadow-sm transition-colors hover:border-accent/40"
      title="Click to disconnect"
    >
      Sui {shorten(address)}
    </button>
  );
}
