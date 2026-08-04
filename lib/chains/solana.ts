import "server-only";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/solana";

/**
 * Server-side Solana settlement checks for the Magic Eden purchase flow —
 * mirrors lib/chains/sui.ts's verifySuiBuyTx/getSuiBalanceMist role exactly
 * (never trust a client-reported signature/balance, independently verify
 * against a real RPC before crediting anything). Reuses the same connection
 * lib/solana.ts already exports for the swap flow's Solana-origin path,
 * rather than a second client.
 */

export async function getSolanaBalanceLamports(address: string): Promise<bigint> {
  const connection = getConnection();
  const lamports = await connection.getBalance(new PublicKey(address));
  return BigInt(lamports);
}

/**
 * 2026-08-04 — SECURITY FIX (same class of bug as lib/chains/evm.ts's
 * verifyEvmBuyTx, see that function's doc comment for the full exploit
 * writeup): this replaced an `isSolanaTxSuccessful` helper (removed, this
 * was its only caller) that only proved SOME transaction succeeded, not
 * that THIS transaction was the buyer actually paying for THIS listing.
 * Verifies the buyer's own wallet was a real SIGNER of the transaction (not
 * just an unrelated account touched by it) and that its SOL balance
 * actually decreased by at least the expected listing price — ties the
 * on-chain proof to the specific purchase's quote.listing_price rather than
 * accepting any successful signature. Paired with a unique constraint on
 * nft_purchases.dest_tx_hash (migration 0015) so the same signature can't
 * be replayed across multiple purchases either.
 *
 * Throws when the signature isn't found yet (still propagating) — same
 * "not found = keep polling, not a hard failure" convention as
 * lib/chains/sui.ts's verifySuiBuyTx, so confirm-buy routes can reuse the
 * identical try/catch shape.
 */
export async function verifySolanaBuyTx(params: {
  signature: string;
  expectedSigner: string;
  minLamportsSpent: bigint;
}): Promise<boolean> {
  const connection = getConnection();
  const tx = await connection.getParsedTransaction(params.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) throw new Error("Transaction not found yet");
  if (tx.meta?.err) return false;

  const accountKeys = tx.transaction.message.accountKeys;
  const signerIndex = accountKeys.findIndex((k) => k.signer && k.pubkey.toBase58() === params.expectedSigner);
  if (signerIndex === -1) return false;

  const preBalance = BigInt(tx.meta?.preBalances?.[signerIndex] ?? 0);
  const postBalance = BigInt(tx.meta?.postBalances?.[signerIndex] ?? 0);
  const spent = preBalance - postBalance;
  return spent >= params.minLamportsSpent;
}
