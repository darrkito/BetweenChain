"use client";

import { useEffect, useState } from "react";

// 2026-08-06 (swap page revamp) — closes the gap useSolanaBalance.ts's own
// comment flagged: "an EVM equivalent would need a new balance-fetching
// capability... not built in this pass." That capability now exists
// (app/api/tokens/balances/route.ts, built for the token picker's "Your
// tokens" section) — this hook is a thin client wrapper around it, same
// {balance, loading} shape as useSolanaBalance so SwapPanel.tsx needs no
// changes to accept either source.
export function useEvmTokenBalance(
  chainId: number | null,
  owner: string | null,
  tokenAddress: string | null,
): { balance: number | null; loading: boolean } {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(async () => {
      if (ignore) return;
      if (!chainId || !owner || !tokenAddress) {
        setBalance(null);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/tokens/balances?chainId=${chainId}&owner=${encodeURIComponent(owner)}`);
        const body: { balances?: Array<{ address: string; balance: string }> } = await res.json();
        const match = (body.balances ?? []).find((b) => b.address.toLowerCase() === tokenAddress.toLowerCase());
        if (!ignore) setBalance(match ? Number(match.balance) : 0);
      } catch {
        if (!ignore) setBalance(null);
      } finally {
        if (!ignore) setLoading(false);
      }
    });
    return () => {
      ignore = true;
    };
  }, [chainId, owner, tokenAddress]);

  return { balance, loading };
}
