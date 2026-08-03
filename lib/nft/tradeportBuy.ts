import "server-only";
import { SuiTradingClient } from "@tradeport/sui-trading-sdk";
import type { Transaction } from "@mysten/sui/transactions";
import { dryRunSuiTransactionCostMist, getSuiBalanceMist, SuiInsufficientBalanceError } from "@/lib/chains/sui";

// Tradeport's NFT TRADING SDK — a separate client from lib/nft/tradeport.ts's
// read-only GraphQL "NFT Data API", confirmed live 2026-07-21 via
// tradeport.xyz/docs/nft-trading-sdk/sui-sdk. Takes the same apiKey/apiUser
// values as the GraphQL client (see .env.example's note on this).
const TRADEPORT_API_KEY = process.env.TRADEPORT_API_KEY;
const TRADEPORT_API_USER = process.env.TRADEPORT_API_USER;

let client: SuiTradingClient | null = null;

function getClient(): SuiTradingClient {
  if (!TRADEPORT_API_KEY || !TRADEPORT_API_USER) {
    throw new Error("TRADEPORT_API_KEY / TRADEPORT_API_USER not set — required for Sui NFT buy execution. See .env.example.");
  }
  if (client) return client;
  client = new SuiTradingClient({ apiKey: TRADEPORT_API_KEY, apiUser: TRADEPORT_API_USER });
  return client;
}

async function buildRawBuyTransaction(params: { listingId: string; walletAddress: string }): Promise<Transaction> {
  return getClient().buyListings({ listingIds: [params.listingId], walletAddress: params.walletAddress });
}

/**
 * Builds a signable Sui Transaction Block for buying one listing — confirmed
 * live 2026-07-21 (docs' full code example) that this returns a real
 * `@mysten/sui` `Transaction` object, NOT executed itself, meant to be
 * serialized across the API boundary and reconstructed client-side via
 * `Transaction.from(serialized)` before `@mysten/dapp-kit`'s
 * `useSignAndExecuteTransaction` signs+submits it — same "server builds,
 * client signs" shape as OpenSea's getOpenSeaBuyCall, just Sui's own
 * transaction format instead of a raw EVM {to,value,data} call.
 *
 * Always call this FRESH, immediately before a signature is requested — the
 * SDK's own on-chain construction is the final and most authoritative
 * staleness check (a sold/delisted listing fails here), but callers should
 * still run isTradeportListingStillActive() first for a clean, fast "sold"
 * response before ever building a transaction — see the Sui purchase quote/
 * execute routes.
 */
export async function buildTradeportBuyTransaction(params: { listingId: string; walletAddress: string }): Promise<string> {
  const tx = await buildRawBuyTransaction(params);
  return tx.serialize();
}

/**
 * ⚠️ Use this (never `listings.price` alone) to determine how much SUI a
 * purchase actually requires — see lib/chains/sui.ts's
 * dryRunSuiTransactionCostMist doc for the real bug this fixes: Tradeport's
 * `buyListings()` deducts its own platform fee/royalty on top of the raw
 * listing price, which isn't visible anywhere in the GraphQL data. This
 * dry-runs the EXACT same transaction `buildTradeportBuyTransaction` would
 * hand to the buyer, so it reflects the true total (price + fee + royalty +
 * gas) whatever Tradeport's contract actually charges.
 */
export async function estimateTradeportBuyCostMist(params: { listingId: string; walletAddress: string }): Promise<bigint> {
  const tx = await buildRawBuyTransaction(params);
  return dryRunSuiTransactionCostMist(tx, params.walletAddress);
}

export type VerifiedBuyTransaction =
  | { sufficient: true; serializedTx: string; costMist: bigint }
  // costMist is null when the dry run itself failed outright (severely
  // underfunded — see SuiInsufficientBalanceError's doc) rather than
  // succeeding with a known exact cost; callers should fall back to an
  // ESTIMATE (e.g. the quote-time listing-price + safety-margin figure)
  // for display in this case, not treat it as an exact number.
  | { sufficient: false; costMist: bigint | null; balanceMist: bigint };

/**
 * The one function both the same-chain execute route and the cross-chain
 * confirm-deposit route should call right before asking for a buy
 * signature — combines the real dry-run cost check with a real balance
 * check, and refuses to hand back a signable transaction if the buyer's
 * wallet can't actually afford it. This is the fix for the CRITICAL bug in
 * lib/chains/sui.ts's doc: never again let a purchase silently draw an
 * unexpected shortfall from unrelated existing balance — surface it as a
 * clear, blocking "insufficient funds" result instead.
 *
 * Builds the transaction exactly once and reuses it for both the dry run
 * and (if sufficient) the final serialization, so the buyer signs the
 * IDENTICAL transaction that was just cost-verified — not a freshly
 * rebuilt one that could in principle differ (e.g. if the listing changed
 * between two separate builds).
 */
export async function buildVerifiedTradeportBuyTransaction(params: {
  listingId: string;
  walletAddress: string;
}): Promise<VerifiedBuyTransaction> {
  const tx = await buildRawBuyTransaction(params);
  const balanceMist = await getSuiBalanceMist(params.walletAddress);
  let costMist: bigint;
  try {
    costMist = await dryRunSuiTransactionCostMist(tx, params.walletAddress);
  } catch (err) {
    if (err instanceof SuiInsufficientBalanceError) {
      return { sufficient: false, costMist: null, balanceMist };
    }
    throw err;
  }
  if (balanceMist < costMist) {
    return { sufficient: false, costMist, balanceMist };
  }
  return { sufficient: true, serializedTx: tx.serialize(), costMist };
}
