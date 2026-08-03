"use client";

import { useState } from "react";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";

/**
 * Lists every real EIP-6963-announced EVM wallet (MetaMask, Rabby, Phantom's
 * EVM support, Coinbase Wallet, …) as its own named button, so connecting
 * always targets the wallet the user actually picked instead of whichever
 * extension happened to win the `window.ethereum` global — see
 * lib/client/EvmWalletProvider.tsx's top comment for the real bug this
 * replaced (2026-07-21). Shared between AppHeader's Connect Wallet popup and
 * NftBuyModal so both offer the same real picker, not two different
 * simplified versions of it.
 */
export function EvmConnectPicker() {
  const evm = useEvmWallet();
  const [clickedUuid, setClickedUuid] = useState<string | null>(null);

  function pick(uuid: string) {
    setClickedUuid(uuid);
    evm.connect(uuid);
  }

  if (evm.providers.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        {/*
          Real gap this covers (copy only — WalletConnect/deep-linking is
          intentionally out of scope for now): no EIP-6963 provider means no
          extension announced itself, which on mobile web is the normal
          case (there's usually no extension to have), not an error state.
          The "Browser wallet" button below still attempts window.ethereum
          directly — harmless to leave clickable since some mobile in-app
          browsers (a wallet app's own built-in browser) DO inject it even
          without EIP-6963 support, so this can genuinely still work there.
        */}
        <p className="px-2 text-[11px] leading-relaxed text-ink-faint">
          No extension detected. On desktop, install MetaMask or another EVM wallet extension. On mobile, open this
          site from inside your wallet app&apos;s own browser.
        </p>
        <button
          onClick={() => pick("legacy")}
          disabled={evm.connecting}
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          <span className="h-5 w-5 shrink-0 rounded bg-surface-hover" />
          <span className="truncate">{evm.connecting ? "Connecting…" : "Try browser wallet anyway"}</span>
        </button>
        {evm.error && <p className="px-2 text-[11px] text-danger">{evm.error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {evm.providers.map((p) => (
        <button
          key={p.uuid}
          onClick={() => pick(p.uuid)}
          disabled={evm.connecting}
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          {p.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- EIP-6963 icons are data: URIs the extension itself provides
            <img src={p.icon} alt="" className="h-5 w-5 shrink-0 rounded" />
          ) : (
            <span className="h-5 w-5 shrink-0 rounded bg-surface-hover" />
          )}
          <span className="truncate">{evm.connecting && clickedUuid === p.uuid ? "Connecting…" : p.name}</span>
        </button>
      ))}
      {evm.error && <p className="px-2 text-[11px] text-danger">{evm.error}</p>}
    </div>
  );
}
