import "server-only";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { getConnection } from "@/lib/solana";
import { getRelayerKeypair } from "@/lib/relayer/keypair";
import { buildRelayDepositTransaction } from "@/lib/client/relayTransaction";
import { getRelayQuote, buildRelayExecutionSteps, RELAY_NATIVE_EVM_SENTINEL, SOLANA_CHAIN_ID } from "@/lib/chains/relay";

// Fully-unattended cross-chain delivery for Trigger Orders (2026-08-09) —
// see lib/relayer/keypair.ts's doc comment for the threat model. This
// function does exactly two things, in order, both signed by the relayer's
// OWN key (never the user's): (1) pull however much of the order's output
// token has actually landed in the user's wallet so far, up to whatever the
// user delegated at order-creation time — never more, since SPL enforces
// the delegated allowance on-chain; (2) swap/bridge that exact amount from
// the relayer's own account to the user's pre-bound destAddress, reusing
// the same Relay quote+execute pipeline every other cross-chain swap in
// this app uses (lib/chains/relay.ts), just with the relayer as the
// signer instead of a connected wallet. Delivers the destination chain's
// NATIVE currency — same scoping decision as the existing manual
// "Deliver now" flow in OrdersClient.tsx.
// Mirrors lib/client/relayTransaction.ts's (unexported) RawRelayInstruction
// shape — buildRelayDepositTransaction's own param type, duplicated here
// rather than exported from a "client" file into server code.
interface RelaySolanaStepData {
  instructions: Array<{
    programId: string;
    data: string;
    keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  }>;
  addressLookupTableAddresses?: string[];
}

export interface DeliverOrderParams {
  userSolanaPubkey: string;
  outputMint: string;
  outputDecimals: number;
  destChainId: number;
  destAddress: string;
}

export type DeliverOrderResult =
  | { status: "nothing-to-deliver" }
  | { status: "delivered"; pullSignature: string; depositSignature: string; amountDelivered: string }
  | { status: "failed"; error: string };

export async function deliverOrder(params: DeliverOrderParams): Promise<DeliverOrderResult> {
  const relayer = getRelayerKeypair();
  if (!relayer) return { status: "failed", error: "Relayer is not configured (RELAYER_SOLANA_SECRET_KEY unset)" };

  const connection = getConnection();
  const mint = new PublicKey(params.outputMint);
  const userAta = getAssociatedTokenAddressSync(mint, new PublicKey(params.userSolanaPubkey));

  let account;
  try {
    account = await getAccount(connection, userAta);
  } catch {
    return { status: "nothing-to-deliver" }; // ATA doesn't exist yet — order hasn't filled
  }

  // The delegated allowance is the real, on-chain-enforced ceiling — this
  // app never trusts its own cached delegate_amount for the actual
  // transfer, only the live account state. Whichever is smaller of "what's
  // actually sitting in the account" and "what we're actually allowed to
  // move" is what gets pulled.
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
        // relayer is the DELEGATE here, not the owner — createTransferCheckedInstruction's
        // 4th arg (owner) is whichever signer is authorizing the move, which for a
        // delegated transfer is the delegate itself. SPL enforces on-chain that this
        // can never exceed account.delegatedAmount, independent of anything this app does.
        createTransferCheckedInstruction(userAta, mint, relayerAta, relayer.publicKey, transferable, params.outputDecimals),
      ],
    }).compileToV0Message();
    const pullTx = new VersionedTransaction(pullMessage);
    pullTx.sign([relayer]);
    const pullSignature = await connection.sendRawTransaction(pullTx.serialize());
    await connection.confirmTransaction({ signature: pullSignature, ...(await connection.getLatestBlockhash()) }, "confirmed");

    const quote = await getRelayQuote({
      amountLamports: transferable.toString(),
      destChainId: params.destChainId,
      destToken: RELAY_NATIVE_EVM_SENTINEL,
      destAddress: params.destAddress,
      originChainId: SOLANA_CHAIN_ID,
      originCurrency: params.outputMint,
      userOriginAddress: relayer.publicKey.toBase58(),
    });
    const steps = await buildRelayExecutionSteps(quote.quote);
    const depositItem = steps[0]?.items?.[0];
    const depositData = depositItem?.data as RelaySolanaStepData | undefined;
    if (!depositData?.instructions) throw new Error("Relay quote did not return deposit instructions");

    const depositTx = await buildRelayDepositTransaction({
      connection,
      payer: relayer.publicKey,
      instructions: depositData.instructions,
      addressLookupTableAddresses: depositData.addressLookupTableAddresses,
    });
    depositTx.sign([relayer]);
    const depositSignature = await connection.sendRawTransaction(depositTx.serialize());
    await connection.confirmTransaction({ signature: depositSignature, ...(await connection.getLatestBlockhash()) }, "confirmed");

    return { status: "delivered", pullSignature, depositSignature, amountDelivered: transferable.toString() };
  } catch (err) {
    return { status: "failed", error: (err as Error).message };
  }
}
