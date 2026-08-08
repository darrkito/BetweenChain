import "server-only";

// ChangeNOW (api.changenow.io) — the bridging engine for cross-chain NFT
// purchases on Sui (pay with ETH, SOL, or BTC — added 2026-08-08 — buy a SUI
// NFT), replacing an earlier Squid Router attempt. Squid's own /chains and /tokens listed Sui,
// but every real ETH→Sui quote tried (2026-07-22, multiple amounts/tokens/
// addresses) failed with "Low liquidity" — Squid's Sui-side token list was
// only 5 tokens, reading as a genuinely thin integration on their end.
// ChangeNOW's ETH→SUI AND SOL→SUI routes were both confirmed live with REAL
// liquidity the same day: 0.05 ETH → ~124 SUI, and separately 0.151 SOL →
// 15.05 SUI, both with real exchange creation end-to-end (deposit addresses
// in the correct format for each origin chain — 0x-hex for ETH, base58 for
// SOL).
//
// ⚠️ DIFFERENT TRUST MODEL from Relay/Squid, worth understanding before
// relying on this — Relay/Squid are on-chain bridges: the buyer's own
// wallet calls a smart contract, and the cryptographic/contract guarantees
// are what move the funds. ChangeNOW is a CUSTODIAL exchange: the buyer
// sends ETH to a deposit address ChangeNOW controls (a plain wallet-to-wallet
// transfer, no contract call at all), and ChangeNOW's own systems send SUI
// to the payout address afterward, off-chain-matched. This is real
// counterparty risk (same category as using Coinbase/Binance to convert
// currency) — not asserted to be trustless. Still safe for THIS app's
// architecture specifically because it preserves the same core guarantee
// the two-signature NFT-buy design has always relied on (see migration
// 0006's original design note): the buyer's own Sui wallet is what
// ultimately holds the SUI and signs the Tradeport buy itself, so there is
// no scenario where funds could be silently redirected mid-flow the way an
// arbitrary destination `call` could have been. If ChangeNOW simply never
// delivers, the buyer is out the ETH they sent — same category of risk as
// any custodial exchange, flagged here explicitly rather than glossed over.
const CHANGENOW_API = "https://api.changenow.io/v2";
const CHANGENOW_API_KEY = process.env.CHANGENOW_API_KEY;

function requireChangeNowKey() {
  if (!CHANGENOW_API_KEY) {
    throw new Error("CHANGENOW_API_KEY is not set — required for ETH/SOL/BTC→SUI cross-chain NFT purchases. See .env.example.");
  }
  return CHANGENOW_API_KEY!;
}

// ChangeNOW's own ticker/network names for the supported origin currencies —
// eth/eth and sol/sol confirmed live 2026-07-22 (native currency ticker
// equals network name for both, unlike some EVM L2s where they'd diverge).
// btc/btc added 2026-08-08 — confirmed live: GET /v2/exchange/currencies
// lists {ticker:"btc", network:"btc", supportsFixedRate:true, buy:true,
// sell:true}, and a real reverse-estimate quote (fromCurrency=btc, exact 20
// SUI out) succeeded with a real rateId — every function below already
// treats this as an opaque string, no BTC-specific branching needed.
export type ChangeNowOriginCurrency = "eth" | "sol" | "btc";

function changenowHeaders(): HeadersInit {
  return { "content-type": "application/json", "x-changenow-api-key": requireChangeNowKey() };
}

export interface ChangeNowReverseEstimate {
  fromAmount: string; // decimal amount in the origin currency (NOT atomic units — ChangeNOW's API speaks plain decimals throughout)
  toAmount: string;
  rateId: string; // locks this rate for `validUntil`, replay verbatim into createExchange
  validUntil: string;
}

/**
 * Thrown when the requested SUI amount falls outside ChangeNOW's tradeable
 * range for this origin currency — a real, expected business constraint
 * (every centralized exchange has a minimum economical trade size), NOT a
 * bug. Confirmed live 2026-07-22: a 0.35 SUI listing (+ gas buffer, ~0.4
 * SUI total) requesting a SOL→SUI reverse quote got a 400
 * `not_valid_params`/"amountTo is too small" response whose own payload
 * carries the real min/max range (in the ORIGIN currency, despite the
 * error text referencing "amountTo" — confirmed by cross-checking against
 * a direct `/v2/exchange/range` call for the same pair, which returned the
 * same order-of-magnitude min/max, live rate fluctuation aside). Cheap
 * listings can legitimately be below ChangeNOW's
 * minimum bridgeable size; callers should show this as a clear "too small
 * to bridge" message, not a scary 502.
 */
export class ChangeNowAmountOutOfRangeError extends Error {
  constructor(
    public readonly minAmount: number,
    public readonly maxAmount: number,
    public readonly fromCurrency: ChangeNowOriginCurrency,
  ) {
    super(`Amount out of range for ${fromCurrency}: min ${minAmount}, max ${maxAmount}`);
  }
}

/**
 * Reverse fixed-rate estimate: "I need exactly `toAmount` of the destination
 * currency delivered, how much of the origin currency does that cost right
 * now" — ChangeNOW's `type=reverse` + `flow=fixed-rate` combination,
 * confirmed live 2026-07-22 for the original SUI destination (0.00816136
 * ETH for an exact 20 SUI output; 0.15099337 SOL for an exact 15.05 SUI
 * output). This is the ChangeNOW equivalent of Relay's EXACT_OUTPUT
 * `/quote/v2` — deterministic, no leftover-amount safety-margin math needed
 * the way Squid's EXACT_INPUT-only model required. `toCurrency`/`toNetwork`
 * generalized 2026-08-08 for BTC<->SOL/ETH general swaps
 * (app/api/quote/btc/route.ts) — still only the reverse/exact-output mode,
 * the one live-verified shape; ChangeNOW's forward/"direct" mode has not
 * been exercised in this codebase.
 */
export async function getChangeNowReverseEstimate(params: {
  fromCurrency: ChangeNowOriginCurrency;
  toAmount: string; // decimal amount of the destination currency
  // Destination currency/network — defaults to "sui" for the original NFT-
  // purchase call sites (app/api/nft/purchase/sui/*), which is the only
  // caller this function had until 2026-08-08's general BTC swap support
  // on /swap needed an arbitrary destination too. Opaque strings, same as
  // ChangeNowOriginCurrency — ChangeNOW's own ticker/network naming, never
  // branched on here.
  toCurrency?: string;
  toNetwork?: string;
}): Promise<ChangeNowReverseEstimate> {
  const toCurrency = params.toCurrency ?? "sui";
  const toNetwork = params.toNetwork ?? toCurrency;
  const url = new URL(`${CHANGENOW_API}/exchange/estimated-amount`);
  url.searchParams.set("fromCurrency", params.fromCurrency);
  url.searchParams.set("fromNetwork", params.fromCurrency);
  url.searchParams.set("toCurrency", toCurrency);
  url.searchParams.set("toNetwork", toNetwork);
  url.searchParams.set("toAmount", params.toAmount);
  url.searchParams.set("flow", "fixed-rate");
  url.searchParams.set("type", "reverse");

  const res = await fetch(url, { headers: changenowHeaders(), cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400) {
      const parsed = JSON.parse(text) as { error?: string; payload?: { range?: { minAmount: number; maxAmount: number } } };
      if (parsed.error === "not_valid_params" && parsed.payload?.range) {
        throw new ChangeNowAmountOutOfRangeError(parsed.payload.range.minAmount, parsed.payload.range.maxAmount, params.fromCurrency);
      }
    }
    throw new Error(`ChangeNOW estimate failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { fromAmount: number; toAmount: number; rateId: string; validUntil: string };
  return {
    fromAmount: body.fromAmount.toString(),
    toAmount: body.toAmount.toString(),
    rateId: body.rateId,
    validUntil: body.validUntil,
  };
}

export interface ChangeNowExchange {
  id: string;
  depositAddress: string; // where the buyer sends ETH/SOL — a plain transfer, no contract call
  fromAmount: string;
  toAmount: string;
  quote: unknown; // raw ChangeNOW response, stored for replay/audit
}

/**
 * Creates the actual exchange — this is the side-effecting step (mirrors
 * this app's "quote is non-binding, execute commits" convention elsewhere:
 * getChangeNowReverseEstimate above has no side effect, this does).
 * `rateId` must come from a getChangeNowReverseEstimate call made just
 * before this — confirmed live it's only valid for a ~10 minute window
 * (`validUntil`). `payoutAddress` is the buyer's own Sui wallet, bound here
 * the same way every other quote-bound destination in this app is (never
 * re-derived from later client input). `depositAddress` comes back in
 * whatever format the origin chain uses — 0x-hex for ETH, base58 for SOL,
 * both confirmed live 2026-07-22.
 */
export async function createChangeNowExchange(params: {
  fromCurrency: ChangeNowOriginCurrency;
  fromAmount: string;
  rateId: string;
  payoutAddress: string;
  toCurrency?: string; // defaults to "sui", see getChangeNowReverseEstimate's doc
  toNetwork?: string;
}): Promise<ChangeNowExchange> {
  const toCurrency = params.toCurrency ?? "sui";
  const toNetwork = params.toNetwork ?? toCurrency;
  const res = await fetch(`${CHANGENOW_API}/exchange`, {
    method: "POST",
    headers: changenowHeaders(),
    body: JSON.stringify({
      fromCurrency: params.fromCurrency,
      fromNetwork: params.fromCurrency,
      toCurrency,
      toNetwork,
      fromAmount: Number(params.fromAmount),
      address: params.payoutAddress,
      flow: "fixed-rate",
      rateId: params.rateId,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ChangeNOW exchange creation failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { id: string; payinAddress: string; fromAmount: number; toAmount: number };
  return {
    id: body.id,
    depositAddress: body.payinAddress,
    fromAmount: body.fromAmount.toString(),
    toAmount: body.toAmount.toString(),
    quote: body,
  };
}

export interface ChangeNowStatus {
  // Real enum confirmed live: "waiting" (no deposit seen yet) is the only
  // value observed directly so far — the rest are ChangeNOW's documented
  // status values, not yet individually exercised live.
  status: "waiting" | "confirming" | "exchanging" | "sending" | "finished" | "failed" | "refunded" | "verifying" | "expired" | string;
  payinHash?: string;
  payoutHash?: string; // the Sui transaction digest, once ChangeNOW sends the SUI — confirmed present as a field on the by-id response (null until sent)
}

/**
 * Polls ChangeNOW's own settlement status — same "never trust a
 * client-reported destination result" principle as getRelayIntentStatus.
 * Confirmed live 2026-07-22 (a real created-but-unfunded exchange returned
 * `status: "waiting"`, `payinHash: null`, `payoutHash: null` — the shape
 * this function reads from). "finished" + a real `payoutHash` has NOT yet
 * been observed live (needs an actual funded test exchange) — confirm this
 * before fully trusting it in production.
 */
export async function getChangeNowExchangeStatus(id: string): Promise<ChangeNowStatus> {
  const url = new URL(`${CHANGENOW_API}/exchange/by-id`);
  url.searchParams.set("id", id);
  const res = await fetch(url, { headers: changenowHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`ChangeNOW status check failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { status: string; payinHash?: string | null; payoutHash?: string | null };
  return {
    status: body.status as ChangeNowStatus["status"],
    payinHash: body.payinHash ?? undefined,
    payoutHash: body.payoutHash ?? undefined,
  };
}
