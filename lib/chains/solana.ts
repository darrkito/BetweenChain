import "server-only";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/solana";

/**
 * Server-side Solana settlement checks for the Magic Eden purchase flow —
 * mirrors lib/chains/sui.ts's isSuiTxSuccessful/getSuiBalanceMist role
 * exactly (never trust a client-reported signature/balance, independently
 * verify against a real RPC before crediting anything). Reuses the same
 * connection lib/solana.ts already exports for the swap flow's Solana-origin
 * path, rather than a second client.
 */
/**
 * Throws when the signature isn't found yet (still propagating) — same
 * "not found = keep polling, not a hard failure" convention as
 * lib/chains/sui.ts's isSuiTxSuccessful (which throws via getTransactionBlock
 * 404ing), so confirm-buy routes can reuse the identical try/catch shape.
 * Returns false only for a REAL on-chain failure (found, but errored).
 */
export async function isSolanaTxSuccessful(signature: string): Promise<boolean> {
  const connection = getConnection();
  const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  const value = status.value;
  if (!value) throw new Error("Signature not found yet");
  if (value.err) return false;
  return value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized";
}

export async function getSolanaBalanceLamports(address: string): Promise<bigint> {
  const connection = getConnection();
  const lamports = await connection.getBalance(new PublicKey(address));
  return BigInt(lamports);
}
