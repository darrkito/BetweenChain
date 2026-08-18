import { Transaction } from "@mysten/sui/transactions";

/**
 * A plain native-SUI transfer — the ChangeNOW deposit step of a SUI-origin
 * swap (see SwapPageClient.tsx's runBtcSwap, generalized 2026-08-18 beyond
 * just BTC). Same role as lib/client/solanaTransfer.ts's
 * buildSolTransferTransaction: ChangeNOW's deposit is a plain wallet-to-
 * wallet transfer to its own deposit address, no bridge-specific
 * instruction data, so a single splitCoins(gas)+transferObjects is the
 * whole transaction — `tx.gas` covers the gas-coin-merge bookkeeping
 * automatically, same as every other SUI transfer in this app's NFT flows.
 */
export function buildSuiTransferTransaction(params: { toAddress: string; mist: bigint }): Transaction {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [params.mist]);
  tx.transferObjects([coin], params.toAddress);
  return tx;
}
