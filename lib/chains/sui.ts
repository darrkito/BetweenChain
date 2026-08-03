import "server-only";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import type { Transaction } from "@mysten/sui/transactions";

// Server-side Sui RPC — mirrors lib/chains/evm.ts's role exactly: independently
// verify a client-reported transaction digest actually succeeded on-chain
// before crediting anything (same "never trust client-reported data"
// principle as every other settlement check in this codebase). Falls back to
// Mysten's own public fullnode, same known rate-limit/no-SLA caveat as every
// other public RPC default here.
//
// `SuiJsonRpcClient`/`getJsonRpcFullnodeUrl` (not `SuiClient`/`getFullnodeUrl`,
// which don't exist in the installed @mysten/sui v2.x — confirmed live
// 2026-07-21, a major API rewrite vs. the older `SuiClient` shape) — the SDK
// itself flags JSON-RPC as deprecated in favor of gRPC/GraphQL clients, but
// it's what @mysten/dapp-kit's SuiClientProvider still expects/returns as of
// this version, so it's the correct current choice, not a shortcut.
let client: SuiJsonRpcClient | null = null;

export function getSuiClient(): SuiJsonRpcClient {
  if (client) return client;
  client = new SuiJsonRpcClient({ url: process.env.SUI_RPC_URL || getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" });
  return client;
}

export async function isSuiTxSuccessful(digest: string): Promise<boolean> {
  const result = await getSuiClient().getTransactionBlock({ digest, options: { showEffects: true } });
  return result.effects?.status.status === "success";
}

export async function getSuiBalanceMist(address: string): Promise<bigint> {
  const balance = await getSuiClient().getBalance({ owner: address });
  return BigInt(balance.totalBalance);
}

const SUI_COIN_TYPE = "0x2::sui::SUI";

// Moved to lib/nft/tradeportFee.ts (2026-07-22) — that file is NOT
// server-only, so the collection listings grid and NftBuyModalSui.tsx can
// show the same fee-inclusive price this module charges, instead of
// silently displaying the raw un-fee'd listing price. Re-exported here so
// existing importers of this module don't need to change.
export { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/nft/tradeportFee";

/**
 * ⚠️ CRITICAL FIX (2026-07-22) — real money-losing bug found live: a
 * completed purchase quoted/delivered exactly 9.05 SUI (9 SUI listing price
 * + a flat 0.05 SUI gas buffer) for an NFT whose REAL on-chain buy
 * transaction cost **9.882504784 SUI** (confirmed by fetching the actual
 * completed transaction's `balanceChanges` from mainnet — digest
 * `DhVc5jLz1A5DDttQxT8j8UwNsMoZeEpLifBg2jDVgojF`). The purchase still
 * completed (it silently drew the ~0.8825 SUI shortfall from the buyer's
 * own pre-existing wallet balance instead of failing), which is exactly why
 * this went undetected until a real user reported an unexpected balance
 * change — a failed transaction would have been loud; a silent overdraw
 * from unrelated existing balance was not.
 *
 * Root cause, confirmed by inspecting the real transaction's events:
 * Tradeport's `buyListings()` Move call charges roughly 9.8% on top of the
 * raw listing price (`0.8825/9 ≈ 9.806%`) that is NOT emitted in any event
 * and does NOT show up as a balance change to any address we can see —
 * almost certainly Kiosk-internal profit accounting (Sui's Kiosk primitive
 * holds sale proceeds inside the Kiosk object itself, not as a plain wallet
 * balance change), which is invisible to any per-address balance-change
 * listing including the raw `listings.price` GraphQL field this app was
 * quoting from.
 *
 * The fix, in two parts:
 * 1. Never trust `listings.price` as the total cost again. Dry-run the
 *    ACTUAL buy transaction (the same one that will be signed) and read its
 *    real net SUI cost from THIS function's balance-change reading — this
 *    captures price + fee + gas exactly, whatever Tradeport's contract
 *    actually charges, without needing to know its fee schedule. Same
 *    principle as lib/chains/evm.ts's estimateBuyCallTotalCostWei (simulate
 *    against real chain state, don't trust a static price field).
 * 2. A real dry run needs the sender to already own enough SUI gas
 *    coins to resolve a valid gas payment (confirmed live: dry-running
 *    against a genuinely empty address fails outright, and Sui's dry-run
 *    RPC has no EVM-style balance-override parameter) — impossible at
 *    QUOTE time for a cross-chain buyer who hasn't been bridged funds yet.
 *    `TRADEPORT_FEE_SAFETY_MARGIN` below (sized from the real 9.8% finding,
 *    with headroom) sizes the bridge amount at quote time; the Sui NFT
 *    purchase routes then run THIS function for real, right before the
 *    buyer signs — by then funds exist (same-chain always had them,
 *    cross-chain has already been bridged) — and BLOCK with a clear
 *    "insufficient funds" error if the real cost exceeds the buyer's actual
 *    balance, instead of silently letting it draw from unrelated funds
 *    again.
 */
// Thrown when the dry run itself fails because the sender is too
// underfunded even to construct a valid gas/payment resolution (confirmed
// live: a wallet with 1.52 SUI trying to buy a 15 SUI listing fails outright
// with "InsufficientCoinBalance in command 1" rather than succeeding with a
// clean negative balance change). In this case there's no reliable exact
// cost figure to read — callers should fall back to an ESTIMATE (e.g. the
// quote-time listing-price + safety-margin figure) rather than crash.
export class SuiInsufficientBalanceError extends Error {
  constructor(reason: string) {
    super(`Sui dry run failed, likely insufficient balance: ${reason}`);
  }
}

export async function dryRunSuiTransactionCostMist(tx: Transaction, senderAddress: string): Promise<bigint> {
  const suiClient = getSuiClient();
  tx.setSenderIfNotSet(senderAddress);
  const bytes = await tx.build({ client: suiClient });
  const result = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes });
  if (result.effects?.status.status !== "success") {
    throw new SuiInsufficientBalanceError(result.effects?.status.error ?? "unknown error");
  }
  const suiChange = result.balanceChanges.find(
    (c) => c.coinType === SUI_COIN_TYPE && typeof c.owner === "object" && "AddressOwner" in c.owner && c.owner.AddressOwner === senderAddress,
  );
  if (!suiChange) throw new Error("Dry run produced no SUI balance change for the buyer's address");
  const amount = BigInt(suiChange.amount);
  if (amount >= BigInt(0)) throw new Error(`Dry run's SUI balance change for the buyer was not negative: ${suiChange.amount}`);
  return -amount; // negative = spent; return the positive cost
}
