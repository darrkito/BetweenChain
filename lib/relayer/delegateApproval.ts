import "server-only";
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createApproveCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getRelayerKeypair } from "@/lib/relayer/keypair";
import { getConnection } from "@/lib/solana";

/**
 * Builds the unsigned delegate-approval transaction a user signs once, at
 * order-creation time, to opt a Trigger Order into fully-unattended
 * cross-chain delivery. This is the bounded-custody mechanism itself: it
 * grants the relayer authority to move UP TO `amountAtomic` of `outputMint`
 * out of the user's own associated token account — nothing more, and SPL
 * enforces that ceiling on-chain regardless of anything this app's backend
 * does afterward. Fee payer and signer is the USER (same wallet that signs
 * the order-creation transaction), never the relayer — the relayer only
 * ever signs the later pull+deliver transactions in
 * lib/relayer/deliverOrder.ts.
 */
export async function buildDelegateApprovalTransaction(params: {
  connection?: Connection;
  owner: string;
  outputMint: string;
  outputDecimals: number;
  amountAtomic: bigint;
}): Promise<{ transaction: string } | null> {
  const relayer = getRelayerKeypair();
  if (!relayer) return null; // not configured — caller falls back to the manual delivery flow

  const connection = params.connection ?? getConnection();
  const owner = new PublicKey(params.owner);
  const mint = new PublicKey(params.outputMint);
  const ata = getAssociatedTokenAddressSync(mint, owner);

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mint),
      createApproveCheckedInstruction(ata, mint, relayer.publicKey, owner, params.amountAtomic, params.outputDecimals),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  return { transaction: Buffer.from(tx.serialize()).toString("base64") };
}

/**
 * Same mechanism as buildDelegateApprovalTransaction, but batches an
 * approve (+ idempotent ATA create) for MULTIPLE tokens into a single
 * transaction — OmniDust Vacuum (2026-08-09): one signature covering every
 * detected dust token, instead of one per token. Each entry's amount
 * should be the token's REAL current balance (dust is a known quantity at
 * authorization time, not an estimate — no buffer needed, unlike Trigger
 * Orders' pre-fill sizing).
 */
export async function buildBatchDelegateApprovalTransaction(params: {
  connection?: Connection;
  owner: string;
  tokens: Array<{ mint: string; decimals: number; amountAtomic: bigint }>;
}): Promise<{ transaction: string } | null> {
  const relayer = getRelayerKeypair();
  if (!relayer || params.tokens.length === 0) return null;

  const connection = params.connection ?? getConnection();
  const owner = new PublicKey(params.owner);

  const instructions = params.tokens.flatMap(({ mint: mintStr, decimals, amountAtomic }) => {
    const mint = new PublicKey(mintStr);
    const ata = getAssociatedTokenAddressSync(mint, owner);
    return [
      createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mint),
      createApproveCheckedInstruction(ata, mint, relayer.publicKey, owner, amountAtomic, decimals),
    ];
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  return { transaction: Buffer.from(tx.serialize()).toString("base64") };
}
