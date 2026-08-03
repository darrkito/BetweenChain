"use client";

import { useEffect, useState } from "react";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

// Real gap fixed 2026-08-03: the swap page never showed the connected
// wallet's balance for the Sell token at all, and had no "Max" shortcut —
// every serious swap UI has both. Solana only for now (native SOL + SPL
// tokens) — an EVM equivalent would need a new balance-fetching capability
// exposed through lib/client/EvmWalletProvider.tsx's context (it currently
// only exposes high-level actions, not a raw balance/provider read), not
// built in this pass.
export function useSolanaBalance(
  connection: Connection,
  owner: PublicKey | null,
  token: { address: string; decimals: number; isNative: boolean } | null,
): { balance: number | null; loading: boolean } {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let ignore = false;
    // Every setState call below is deferred via Promise.resolve().then(...)
    // — same pattern used elsewhere in this app (e.g. ConnectWalletMenu's
    // `mounted` flag) to avoid the "set-state-in-effect" lint rule, not just
    // for the reset-to-null branch.
    Promise.resolve().then(async () => {
      if (ignore) return;
      if (!owner || !token) {
        setBalance(null);
        return;
      }
      setLoading(true);
      try {
        const value = token.isNative
          ? (await connection.getBalance(owner)) / 1e9
          : (await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(token.address) })).value.reduce(
              (sum, acc) => sum + (acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
              0,
            );
        if (!ignore) setBalance(value);
      } catch {
        if (!ignore) setBalance(null);
      } finally {
        if (!ignore) setLoading(false);
      }
    });
    return () => {
      ignore = true;
    };
    // Depends on primitives, not the `token` object reference — a new
    // object literal passed in every render (the common call shape here)
    // would otherwise re-trigger this fetch on every render regardless of
    // whether the actual token changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, owner?.toBase58(), token?.address, token?.isNative]);

  return { balance, loading };
}
