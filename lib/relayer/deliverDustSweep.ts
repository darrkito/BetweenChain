import "server-only";
import { PublicKey, TransactionMessage, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { getConnection } from "@/lib/solana";
import { getRelayerKeypair } from "@/lib/relayer/keypair";
import { getJupiterQuote, buildJupiterSwapTransaction, NATIVE_SOL_MINT } from "@/lib/chains/jupiter";

// OmniDust Vacuum (2026-08-09, v1 Solana-only) — pulls a dust token via the
// bounded SPL delegate the user already approved (see
// lib/relayer/delegateApproval.ts's batch builder), swaps it to native SOL
// via Jupiter using the relayer's OWN account, then sends the resulting
// SOL straight back to the user's own wallet. Same threat model as
// lib/relayer/deliverOrder.ts (SECURITY.md's "Trigger Order relayer"
// entry) — this is the same relayer key, same bounded-by-on-chain-approval
// guarantee, just delivering same-wallet instead of cross-chain.
export interface DeliverDustSweepParams {
  userSolanaPubkey: string;
  tokenMint: string;
  tokenDecimals: number;
}

export type DeliverDustSweepResult =
  | { status: "nothing-to-deliver" }
  | { status: "delivered"; pullSignature: string; swapSignature: string; sendSignature: string; amountSwept: string }
  | { status: "failed"; error: string };

export async function deliverDustSweep(params: DeliverDustSweepParams): Promise<DeliverDustSweepResult> {
  const relayer = getRelayerKeypair();
  if (!relayer) return { status: "failed", error: "Relayer is not configured (RELAYER_SOLANA_SECRET_KEY unset)" };

  const connection = getConnection();
  const mint = new PublicKey(params.tokenMint);
  const owner = new PublicKey(params.userSolanaPubkey);
  const userAta = getAssociatedTokenAddressSync(mint, owner);

  let account;
  try {
    account = await getAccount(connection, userAta);
  } catch {
    return { status: "nothing-to-deliver" };
  }

  const transferable = account.delegatedAmount < account.amount ? account.delegatedAmount : account.amount;
  if (transferable <= BigInt(0)) return { status: "nothing-to-deliver" };

  try {
    const relayerAta = getAssociatedTokenAddressSync(mint, relayer.publicKey);
    const { blockhash } = await connection.getLatestBlockhash();
    const pullMessage = new TransactionMessage({
      payerKey: relayer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, relayerAta, relayer.publicKey, mint),
        createTransferCheckedInstruction(userAta, mint, relayerAta, relayer.publicKey, transferable, params.tokenDecimals),
      ],
    }).compileToV0Message();
    const pullTx = new VersionedTransaction(pullMessage);
    pullTx.sign([relayer]);
    const pullSignature = await connection.sendRawTransaction(pullTx.serialize());
    await connection.confirmTransaction({ signature: pullSignature, ...(await connection.getLatestBlockhash()) }, "confirmed");

    // Swap the pulled dust to native SOL, using the relayer as both the
    // quote/swap owner (it now legitimately holds the tokens) and fee payer.
    // Balance measured immediately before/after so only the ACTUAL SOL this
    // swap produced gets forwarded — never the relayer's total balance,
    // which also holds its own gas float and any other in-flight sweeps.
    const balanceBefore = await connection.getBalance(relayer.publicKey);
    const quote = await getJupiterQuote({ sourceMint: params.tokenMint, destinationMint: NATIVE_SOL_MINT, amount: transferable.toString(), slippageBps: 300 });
    const { swapTransaction } = await buildJupiterSwapTransaction({ route: quote.route, userPublicKey: relayer.publicKey.toBase58() });
    const swapTx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    swapTx.sign([relayer]);
    const swapSignature = await connection.sendRawTransaction(swapTx.serialize());
    await connection.confirmTransaction({ signature: swapSignature, ...(await connection.getLatestBlockhash()) }, "confirmed");
    const balanceAfter = await connection.getBalance(relayer.publicKey);

    // Send exactly what this swap produced back to the user, minus a
    // buffer for the send transaction's own fee. Sized generously
    // (0.00005 SOL, ~10x a base 5000-lamport fee) rather than the bare
    // minimum: if this send fails, the swept SOL is stuck in the relayer
    // with no automatic retry (a retry would re-run the pull step, find
    // the user's ATA already empty, and report "nothing to deliver" —
    // never re-attempting the stuck send). Documented as a known residual
    // risk in SECURITY.md rather than silently accepted; a tighter buffer
    // makes the failure mode MORE likely, not less risky, so err generous.
    const SEND_TX_RESERVE_LAMPORTS = 50_000;
    const sendAmount = balanceAfter - balanceBefore - SEND_TX_RESERVE_LAMPORTS;
    if (sendAmount <= 0) throw new Error("Swap produced no net SOL after fees — nothing to forward");

    const { blockhash: sendBlockhash } = await connection.getLatestBlockhash();
    const sendMessage = new TransactionMessage({
      payerKey: relayer.publicKey,
      recentBlockhash: sendBlockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: owner, lamports: sendAmount })],
    }).compileToV0Message();
    const sendTx = new VersionedTransaction(sendMessage);
    sendTx.sign([relayer]);
    const sendSignature = await connection.sendRawTransaction(sendTx.serialize());
    await connection.confirmTransaction({ signature: sendSignature, ...(await connection.getLatestBlockhash()) }, "confirmed");

    return { status: "delivered", pullSignature, swapSignature, sendSignature, amountSwept: transferable.toString() };
  } catch (err) {
    return { status: "failed", error: (err as Error).message };
  }
}
