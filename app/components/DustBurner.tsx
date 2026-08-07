"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createCloseAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { filterZeroBalanceAccounts, sumReclaimableLamports, batchAccounts, type TokenAccountInfo } from "@/lib/client/dustAccounts";

function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(5);
}

// Dust token burner (2026-08-07) — reclaims real rent SOL from genuinely
// empty (zero-balance) SPL token accounts. Real signature verified against
// @solana/spl-token's own type declarations before writing this
// (createCloseAccountInstruction(account, destination, authority,
// multiSigners, programId)) — not guessed from memory. Filtering/batching
// logic lives in lib/client/dustAccounts.ts (pure, unit-tested); this
// component is the wallet/RPC wiring around it, same split as
// lib/client/relayTransaction.ts vs. its callers.
export function DustBurner() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [scanning, setScanning] = useState(false);
  const [dustAccounts, setDustAccounts] = useState<TokenAccountInfo[] | null>(null);
  const [closing, setClosing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function scan() {
    if (!publicKey) {
      setMessage("Connect a Solana wallet first.");
      return;
    }
    setScanning(true);
    setMessage(null);
    setDustAccounts(null);
    try {
      const resp = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
      const accounts: TokenAccountInfo[] = resp.value.map((a) => ({
        pubkey: a.pubkey.toBase58(),
        mint: a.account.data.parsed.info.mint,
        amount: a.account.data.parsed.info.tokenAmount.amount,
        lamports: a.account.lamports,
      }));
      setDustAccounts(filterZeroBalanceAccounts(accounts));
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function closeAll() {
    if (!publicKey || !signTransaction || !dustAccounts || dustAccounts.length === 0) return;
    setClosing(true);
    setMessage(null);
    const batches = batchAccounts(dustAccounts);
    setProgress({ done: 0, total: batches.length });
    try {
      for (let i = 0; i < batches.length; i++) {
        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
        for (const account of batches[i]) {
          tx.add(createCloseAccountInstruction(new PublicKey(account.pubkey), publicKey, publicKey, [], TOKEN_PROGRAM_ID));
        }
        const signed = await signTransaction(tx);
        const signature = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(signature, "confirmed");
        setProgress({ done: i + 1, total: batches.length });
      }
      setMessage(
        `Closed ${dustAccounts.length} empty token account${dustAccounts.length === 1 ? "" : "s"} — reclaimed SOL should now be in your wallet.`,
      );
      setDustAccounts([]);
    } catch (err) {
      // Partial progress is real and already on-chain (each batch is its own
      // confirmed transaction) — surfacing how far it got rather than a
      // generic "failed" that implies nothing happened.
      setMessage(`Stopped after ${progress?.done ?? 0} of ${batches.length} batches: ${(err as Error).message}`);
    } finally {
      setClosing(false);
    }
  }

  const reclaimableSol = dustAccounts ? lamportsToSol(sumReclaimableLamports(dustAccounts)) : null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">Clean up empty token accounts</p>
        <p className="text-xs text-ink-faint">
          Closes genuinely zero-balance SPL token accounts (leftover from dust/rug tokens) and reclaims their real
          rent SOL back to your wallet.
        </p>
      </div>

      {dustAccounts === null ? (
        <button
          onClick={scan}
          disabled={scanning || !publicKey}
          className="self-start rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-semibold text-accent transition-all hover:border-accent/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {scanning ? "Scanning…" : !publicKey ? "Connect a Solana wallet" : "Scan for empty accounts"}
        </button>
      ) : dustAccounts.length === 0 ? (
        <p className="text-sm text-ink-faint">No empty token accounts found — nothing to clean up.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="num text-sm text-ink">
            {dustAccounts.length} empty account{dustAccounts.length === 1 ? "" : "s"} found — reclaim ~{reclaimableSol}{" "}
            SOL
          </p>
          <button
            onClick={closeAll}
            disabled={closing}
            className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {closing ? `Closing… (${progress?.done ?? 0}/${progress?.total ?? 0})` : "Close accounts & reclaim SOL"}
          </button>
        </div>
      )}

      {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
    </section>
  );
}
