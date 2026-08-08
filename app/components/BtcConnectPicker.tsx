"use client";

import { useState } from "react";
import { useBtcWallet } from "@/lib/client/BtcWalletProvider";

// Lists every real sats-connect-announced Bitcoin wallet (Xverse, or any
// other compatible one — sats-connect is not Xverse-exclusive) by name, same
// "list detected providers, click to connect" shape as EvmConnectPicker.tsx/
// SuiConnectPicker.tsx.
export function BtcConnectPicker() {
  const { providers, connecting, error, connect } = useBtcWallet();
  const [clickedId, setClickedId] = useState<string | null>(null);

  function pick(providerId: string) {
    setClickedId(providerId);
    connect(providerId);
  }

  if (providers.length === 0) {
    return <p className="px-2 text-xs text-ink-faint">No Bitcoin wallet detected — install Xverse.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {providers.map((p) => (
        <button
          key={p.id}
          onClick={() => pick(p.id)}
          disabled={connecting}
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          {p.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- sats-connect provider icons are data: URIs the extension itself provides
            <img src={p.icon} alt="" className="h-5 w-5 shrink-0 rounded" />
          ) : (
            <span className="h-5 w-5 shrink-0 rounded bg-surface-hover" />
          )}
          <span className="truncate">{connecting && clickedId === p.id ? "Connecting…" : p.name}</span>
        </button>
      ))}
      {error && <p className="px-2 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
