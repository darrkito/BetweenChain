import {
  type Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";

interface RawRelayInstruction {
  programId: string;
  data: string; // hex
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
}

/**
 * Builds a signable VersionedTransaction from Relay's raw "deposit" step
 * data. This step is a Solana transaction even for a Solana -> EVM/other
 * chain bridge — see the note in lib/chains/relay.ts. No EVM wallet is ever
 * involved; the same connected Solana wallet signs this.
 */
export async function buildRelayDepositTransaction(params: {
  connection: Connection;
  payer: PublicKey;
  instructions: RawRelayInstruction[];
  addressLookupTableAddresses?: string[];
}): Promise<VersionedTransaction> {
  const { connection, payer, instructions, addressLookupTableAddresses = [] } = params;

  const parsedInstructions = instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.keys.map((k) => ({
          pubkey: new PublicKey(k.pubkey),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(ix.data, "hex"),
      }),
  );

  const lookupTableAccounts: AddressLookupTableAccount[] = [];
  for (const address of addressLookupTableAddresses) {
    const result = await connection.getAddressLookupTable(new PublicKey(address));
    if (result.value) lookupTableAccounts.push(result.value);
  }

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: parsedInstructions,
  }).compileToV0Message(lookupTableAccounts);

  return new VersionedTransaction(message);
}
