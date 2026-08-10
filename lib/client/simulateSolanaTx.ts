"use client";

import type { Connection, VersionedTransaction } from "@solana/web3.js";

// Pre-flight Sandbox Simulation Engine, Solana slice (2026-08-10) — see
// PLAN_SANDBOX_SIMULATION.md. Solana's real simulateTransaction RPC method
// already returns exact pre/post token + SOL balances for the whole signed
// transaction (confirmed live against api.mainnet-beta.solana.com before
// writing this) — no new vendor, no new cost, purely read-only. Calling the
// raw JSON-RPC method directly rather than Connection.simulateTransaction()
// because web3.js's wrapper only exposes {err, logs, accounts, unitsConsumed,
// returnData} — it does NOT surface preTokenBalances/postTokenBalances, which
// is the whole point of this call.
export interface SimulatedTokenDelta {
  mint: string;
  uiAmountBefore: number;
  uiAmountAfter: number;
  uiAmountDelta: number;
}

export interface SimulatedSwapResult {
  ok: boolean;
  /** Human-readable failure reason from the simulator, if `ok` is false. */
  error: string | null;
  /** Fee payer's SOL balance change, in SOL (not lamports). Assumes the fee
   * payer is account index 0 — true for every transaction this app builds
   * (payerKey is always set to the connected wallet). */
  solDelta: number | null;
  tokenDeltas: SimulatedTokenDelta[];
}

export async function simulateSwapTransaction(connection: Connection, tx: VersionedTransaction, ownerBase58: string): Promise<SimulatedSwapResult> {
  const res = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [
        Buffer.from(tx.serialize()).toString("base64"),
        { encoding: "base64", commitment: "confirmed", replaceRecentBlockhash: true, sigVerify: false },
      ],
    }),
  });
  const body = await res.json();
  const value = body?.result?.value;
  if (!value) return { ok: false, error: "Simulation request failed", solDelta: null, tokenDeltas: [] };
  if (value.err) return { ok: false, error: JSON.stringify(value.err), solDelta: null, tokenDeltas: [] };

  const preBalances: number[] | undefined = value.preBalances;
  const postBalances: number[] | undefined = value.postBalances;
  const solDelta = preBalances && postBalances && preBalances.length > 0 && postBalances.length > 0 ? (postBalances[0] - preBalances[0]) / 1e9 : null;

  interface RawTokenBalance {
    owner?: string;
    mint: string;
    uiTokenAmount: { uiAmount: number | null };
  }
  const pre: RawTokenBalance[] = value.preTokenBalances ?? [];
  const post: RawTokenBalance[] = value.postTokenBalances ?? [];
  const ownerMints = new Set([...pre, ...post].filter((b) => b.owner === ownerBase58).map((b) => b.mint));
  const tokenDeltas: SimulatedTokenDelta[] = [...ownerMints].map((mint) => {
    const before = pre.find((b) => b.owner === ownerBase58 && b.mint === mint)?.uiTokenAmount.uiAmount ?? 0;
    const after = post.find((b) => b.owner === ownerBase58 && b.mint === mint)?.uiTokenAmount.uiAmount ?? 0;
    return { mint, uiAmountBefore: before, uiAmountAfter: after, uiAmountDelta: after - before };
  });

  return { ok: true, error: null, solDelta, tokenDeltas };
}
