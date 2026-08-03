"use client";

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Minimal connect button for the EVM signing tool used only when the Sell
 * side picks a non-Solana chain — not a full wallet-adapter-style provider
 * tree, deliberately (see lib/client/useEvmWallet.ts).
 */
export function EvmWalletButton({
  address,
  connecting,
  error,
  onConnect,
}: {
  address: string | null;
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onConnect}
        disabled={connecting || Boolean(address)}
        className="num rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-accent shadow-sm transition-colors hover:border-accent/40 disabled:opacity-70"
      >
        {address ? `EVM ${shorten(address)}` : connecting ? "Connecting…" : "Connect EVM wallet"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
