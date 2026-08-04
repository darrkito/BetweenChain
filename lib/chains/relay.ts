import "server-only";
import type { TokenListItem } from "@/lib/chains/types";
import { relayAppFees } from "@/lib/fees";
import { EVM_CHAINS } from "@/lib/nft/evmChains";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { cached } from "@/lib/cache";

const RELAY_API = process.env.RELAY_API ?? "https://api.relay.link";
export const SOLANA_CHAIN_ID = 792703809; // Relay's chain id for Solana mainnet

// Relay's address for native SOL — NOT the wrapped-SOL SPL mint (see
// lib/client/constants.ts's normalizeSolanaSourceMint for that distinction
// on the source side). Any caller passing "SOL" as a destination currency
// for a Solana destChainId must translate it to this first, or Relay
// rejects the request outright ("Invalid input or output currency",
// confirmed live — see STATE.md 2026-07-18i). This only matters when Relay
// is actually invoked for a Solana destination, which never happened before
// non-Solana origins existed (a Solana-origin swap to Solana always skipped
// Relay entirely via the same-chain shortcut).
export const RELAY_NATIVE_SOL_SENTINEL = "11111111111111111111111111111111";

// Relay's address for native currency on any EVM chain (ETH on Ethereum,
// MATIC on Polygon, ...) — the standard all-zero address convention,
// confirmed live 2026-07-20 against Relay's /quote/v2 for native ETH.
export const RELAY_NATIVE_EVM_SENTINEL = "0x0000000000000000000000000000000000000000";

// OpenSea chain-slug -> Relay's numeric destination chain id. Derived from
// lib/nft/evmChains.ts's EVM_CHAINS (single shared source of truth with the
// browse-page chain picker) — add a chain there, not here, to extend NFT
// buy support to more EVM chains.
export const OPENSEA_CHAIN_SLUG_TO_RELAY_ID: Record<string, number> = Object.fromEntries(
  EVM_CHAINS.map((c) => [c.slug, c.chainId]),
);

// Placeholder addresses used ONLY for unauthenticated price previews, when no
// wallet is connected yet and there's no real destination address to bind.
// Verified live against Relay's /quote: it returns full, accurate pricing
// for any well-formed sender/recipient pair — these are never used for an
// actual transaction (execution always goes through /api/quote's
// session-bound, address-bound flow instead). Sender and recipient must
// differ or Relay rejects the request as a same-address "send".
export const PREVIEW_SOLANA_PLACEHOLDER = "11111111111111111111111111111111"; // Solana System Program id
export const PREVIEW_EVM_PLACEHOLDER = "0x000000000000000000000000000000000000dead"; // well-known burn address, used as recipient
// Distinct from PREVIEW_EVM_PLACEHOLDER — needed as the *sender* placeholder
// when previewing a non-Solana EVM origin, since Relay rejects a request
// where sender === recipient (confirmed live) and both could otherwise land
// on an EVM chain in the same preview call.
export const PREVIEW_EVM_ORIGIN_PLACEHOLDER = "0x000000000000000000000000000000000000cafe";

interface RawRelayCurrency {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  metadata?: { logoURI?: string; verified?: boolean; isNative?: boolean };
}

function toTokenListItem(c: RawRelayCurrency, source: TokenListItem["source"]): TokenListItem {
  return {
    chainId: c.chainId,
    address: c.address,
    symbol: c.symbol,
    name: c.name,
    decimals: c.decimals,
    logoURI: c.metadata?.logoURI ?? "",
    verified: c.metadata?.verified ?? false,
    isNative: c.metadata?.isNative ?? false,
    source,
  };
}

/**
 * Full-text token search for a chain — powers the token-select modal's
 * search box ("Search for a token or paste address").
 */
// 2026-08-04 (API-hit reduction pass, mirrors the same fix on
// searchJupiterTokens) — was completely uncached, hit fresh on every
// debounced keystroke. Same 30s TTL reasoning: token search results don't
// change minute to minute, and popular terms are searched identically by
// many users.
const SEARCH_TTL_MS = 30_000;

export async function searchRelayCurrencies(chainId: number, term: string, limit = 30): Promise<TokenListItem[]> {
  return cached(`relay:search:${chainId}:${term}:${limit}`, SEARCH_TTL_MS, async () => {
    const res = await fetchWithTimeout(`${RELAY_API}/currencies/v2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainIds: [chainId], term, limit }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Relay currencies search failed (${res.status})`);
    const currencies = (await res.json()) as RawRelayCurrency[];
    return currencies.map((c) => toTokenListItem(c, "search"));
  });
}

/**
 * Batch existence/routability check: given a chain and a list of candidate
 * addresses (e.g. from a trending-tokens source Relay doesn't itself index),
 * returns only the ones Relay actually recognizes for that chain. Used to
 * stop a trending pick from being un-bridgeable — see SECURITY.md /
 * AGENTS.md notes on the quote-binding model this feeds into.
 */
export async function filterRoutableCurrencies(
  chainId: number,
  addresses: string[],
): Promise<Map<string, TokenListItem>> {
  if (addresses.length === 0) return new Map();

  const res = await fetchWithTimeout(`${RELAY_API}/currencies/v2`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens: addresses.map((a) => `${chainId}:${a}`), limit: addresses.length }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Relay currencies batch lookup failed (${res.status})`);
  const currencies = (await res.json()) as RawRelayCurrency[];

  const byAddress = new Map<string, TokenListItem>();
  for (const c of currencies) {
    byAddress.set(c.address.toLowerCase(), toTokenListItem(c, "trending"));
  }
  return byAddress;
}

export interface RelayQuote {
  destChainId: number;
  destToken: string;
  destAddress: string;
  inAmountLamports: string;
  expectedOutAmount: string;
  expectedOutAmountFormatted: string;
  expectedOutAmountUsd: string;
  expectedOutDecimals: number;
  quote: unknown; // raw Relay quote response, replayed into /execute
}

/**
 * Quotes originCurrency (on originChainId) -> destination chain/token.
 * destAddress must be the same address bound in swap_quotes — Relay does not
 * see or decide the destination independently.
 *
 * originChainId/originCurrency/userOriginAddress default to Solana/native-SOL
 * for backward compatibility with the Solana-origin path (leg 2 after
 * Jupiter's leg 1 — see AGENTS.md), but are fully general: confirmed live
 * that Relay accepts arbitrary origin tokens on arbitrary chains directly
 * (e.g. USDC on Ethereum → SOL, no Jupiter involved) — see STATE.md
 * 2026-07-18i. Callers for non-Solana origins MUST pass userOriginAddress as
 * the address that will actually sign the deposit transaction (never a
 * free-text value) — see the refund-safety note in that STATE.md entry.
 * `userSolanaAddress` is optional (2026-07-21, EVM-only sessions) — it's
 * only ever used as a fallback default for `userOriginAddress` on the
 * Solana-origin path; a non-Solana-origin caller that already passes
 * `userOriginAddress` explicitly doesn't need it at all.
 */
export async function getRelayQuote(params: {
  amountLamports: string;
  destChainId: number;
  destToken: string;
  destAddress: string;
  userSolanaAddress?: string;
  originChainId?: number;
  originCurrency?: string;
  userOriginAddress?: string;
}): Promise<RelayQuote> {
  const {
    amountLamports,
    destChainId,
    destToken,
    destAddress,
    userSolanaAddress,
    originChainId = SOLANA_CHAIN_ID,
    originCurrency = RELAY_NATIVE_SOL_SENTINEL,
    userOriginAddress = userSolanaAddress,
  } = params;
  if (!userOriginAddress) throw new Error("getRelayQuote requires userOriginAddress or userSolanaAddress");

  const res = await fetchWithTimeout(`${RELAY_API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: userOriginAddress,
      recipient: destAddress,
      originChainId,
      destinationChainId: destChainId,
      originCurrency,
      destinationCurrency: destToken,
      amount: amountLamports,
      tradeType: "EXACT_INPUT",
      // Active as soon as RELAY_FEE_RECIPIENT is set — no external
      // account/registration needed for this leg, unlike Jupiter's. See
      // lib/fees.ts.
      ...(relayAppFees() ? { appFees: relayAppFees() } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Relay quote failed (${res.status}): ${await res.text()}`);
  }
  const quote = await res.json();
  const currencyOut = quote?.details?.currencyOut;

  return {
    destChainId,
    destToken,
    destAddress,
    inAmountLamports: amountLamports,
    expectedOutAmount: currencyOut?.amount ?? "0",
    expectedOutAmountFormatted: currencyOut?.amountFormatted ?? "0",
    expectedOutAmountUsd: currencyOut?.amountUsd ?? "0",
    expectedOutDecimals: currencyOut?.currency?.decimals ?? 18,
    quote,
  };
}

export interface RelayCallQuote {
  originChainId: number;
  originCurrency: string;
  originAmount: string;
  originAmountFormatted: string;
  originAmountUsd: string;
  requestId?: string;
  quote: unknown; // raw Relay quote response, replayed into buildRelayExecutionSteps
}

/**
 * Quotes originCurrency (on originChainId) -> an EXACT destination amount of
 * destCurrency, delivered to `recipient` — `tradeType: EXACT_OUTPUT` on
 * `/quote/v2` (the original `getRelayQuote` above targets `/quote` v1 with
 * `EXACT_INPUT`; this is the reverse: we know the exact destination cost —
 * e.g. an NFT's listed price — and need Relay to solve for how much origin
 * currency covers it).
 *
 * DELIBERATELY DOES NOT SUPPORT `txs` (arbitrary destination-chain calls),
 * even though `/quote/v2` itself does — that capability was removed after a
 * real safety finding (2026-07-20): Relay's own docs confirm a `txs` call
 * executes with `msg.sender` = Relay's Multicaller contract, not the end
 * user. That's fine for a call whose entire purpose IS a token transfer to
 * an address the call specifies (Relay expects and prices that). It is NOT
 * fine for a call like Seaport's `fulfillBasicOrder`, which sends its output
 * (the NFT) unconditionally to `msg.sender` with no recipient override — the
 * NFT would go to Relay's contract, not the buyer, likely un-recoverable.
 * This is why NFT purchases use a two-signature pattern instead (see
 * lib/nft/opensea.ts's getOpenSeaBuyCall): this function only ever delivers
 * a plain token amount to `recipient`, who then separately signs the actual
 * marketplace buy themselves, as the real msg.sender. Do not reintroduce
 * `txs` here without re-deriving this finding for whatever new use case
 * prompts it.
 */
export async function getRelayCallQuote(params: {
  originChainId: number;
  originCurrency: string;
  userOriginAddress: string;
  destChainId: number;
  destCurrency: string;
  destAmount: string; // exact wei amount to deliver — e.g. an OpenSea listing's price
  recipient: string; // must be an address the caller can independently sign from afterward
}): Promise<RelayCallQuote> {
  const res = await fetchWithTimeout(`${RELAY_API}/quote/v2`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: params.userOriginAddress,
      recipient: params.recipient,
      originChainId: params.originChainId,
      destinationChainId: params.destChainId,
      originCurrency: params.originCurrency,
      destinationCurrency: params.destCurrency,
      amount: params.destAmount,
      tradeType: "EXACT_OUTPUT",
      ...(relayAppFees() ? { appFees: relayAppFees() } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Relay call quote failed (${res.status}): ${await res.text()}`);
  }
  const quote = await res.json();
  const currencyIn = quote?.details?.currencyIn;

  return {
    originChainId: params.originChainId,
    originCurrency: params.originCurrency,
    originAmount: currencyIn?.amount ?? "0",
    originAmountFormatted: currencyIn?.amountFormatted ?? "0",
    originAmountUsd: currencyIn?.amountUsd ?? "0",
    requestId: quote?.steps?.[0]?.requestId,
    quote,
  };
}

interface SolanaStepData {
  instructions: Array<{
    programId: string;
    data: string; // hex
    keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  }>;
  addressLookupTableAddresses?: string[];
}

interface EvmStepData {
  from: string;
  to: string;
  data: string;
  value?: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

interface RelayStep {
  id: string; // e.g. "approve", "deposit" — an ERC20 origin returns both, in order; a
  // native-currency or Solana origin returns just "deposit". Callers must
  // iterate ALL steps in array order, not assume a fixed count.
  requestId: string;
  kind: string;
  items: Array<{
    data?: SolanaStepData | EvmStepData;
    check?: { method: string; endpoint: string };
  }>;
}

/**
 * Returns the unsigned origin-chain step(s) needed to execute a
 * previously-fetched Relay quote. Like Jupiter, the quote object must be
 * replayed verbatim — never rebuilt from user input at execution time — so
 * the bound destination address from swap_quotes stays authoritative end to
 * end.
 *
 * The step's chain matches the ORIGIN chain, not the destination — the user
 * deposits the origin asset on the origin chain, and Relay's solver network
 * delivers the destination asset autonomously; no destination-chain wallet
 * or signature is ever needed. For a Solana origin this is a Solana
 * transaction (raw instructions + address lookup tables, Solana-format
 * pubkeys, see lib/client/relayTransaction.ts) — confirmed live even when
 * bridging *to* an EVM chain (an earlier version of this codebase incorrectly
 * assumed EVM signing was needed here — see STATE.md 2026-07-18e). For an
 * EVM origin, the step(s) are ready-to-send EVM transactions
 * ({from,to,data,value,chainId,...}) — confirmed live, including that an
 * ERC20 origin returns a separate leading "approve" step before "deposit"
 * (see STATE.md 2026-07-18i).
 */
export async function buildRelayExecutionSteps(quote: unknown): Promise<RelayStep[]> {
  return (quote as { steps: RelayStep[] }).steps;
}

export function getRelayRequestId(quote: unknown): string | undefined {
  return (quote as { steps?: RelayStep[] }).steps?.[0]?.requestId;
}

export interface RelayIntentStatus {
  status: "pending" | "success" | "failure" | "fallback" | "received" | "refund" | "unknown";
  txHashes?: string[];
  inTxHashes?: string[];
}

/**
 * Polls Relay's own settlement status for a previously-submitted deposit —
 * this is what lets app/api/bridge/confirm verify a swap actually completed
 * server-side instead of trusting a client-supplied tx hash (see
 * SECURITY.md's "trusts client" gap, closed by this function).
 */
export async function getRelayIntentStatus(requestId: string): Promise<RelayIntentStatus> {
  const res = await fetchWithTimeout(`${RELAY_API}/intents/status?requestId=${encodeURIComponent(requestId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Relay intent status check failed (${res.status})`);
  return res.json();
}
