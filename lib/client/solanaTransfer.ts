import { type Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

/**
 * A plain native-SOL transfer — used for the ChangeNOW deposit step of a
 * SOL→SUI cross-chain NFT purchase (see NftBuyModalSui.tsx). Deliberately
 * NOT Relay's raw-instructions parsing (lib/client/relayTransaction.ts) —
 * ChangeNOW's deposit is a plain wallet-to-wallet transfer to its own
 * deposit address, no bridge-specific instruction data at all, so a single
 * SystemProgram.transfer is the whole transaction.
 */
export async function buildSolTransferTransaction(params: {
  connection: Connection;
  payer: PublicKey;
  toAddress: string;
  lamports: number;
}): Promise<Transaction> {
  const { connection, payer, toAddress, lamports } = params;
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
  tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(toAddress), lamports }));
  return tx;
}
