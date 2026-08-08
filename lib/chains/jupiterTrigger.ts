import "server-only";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

// Trigger Orders (2026-08-08) — Jupiter's real Trigger (price/limit) and
// Recurring (DCA) APIs, both confirmed live via direct `curl` against
// lite-api.jup.ag (the docs site at developers.jup.ag returned broken
// redirects/404s during this pass — verified against the actual API
// instead, same discipline as every other vendor integration this
// session). No API key required on the lite tier — confirmed: every
// response was either a Zod/schema validation error or a real business
// error (e.g. minimum order size), never an auth error.
//
// Both products are non-custodial: Jupiter's own on-chain program escrows
// the input token in a program-owned PDA, and Jupiter's own keeper network
// executes the fill when the price/schedule condition is met. This app
// never holds funds and never runs a keeper — createOrder just returns an
// unsigned transaction for the user's own wallet to sign, exactly like
// getJupiterQuote's swap step.
const TRIGGER_API = "https://lite-api.jup.ag/trigger/v1";
const RECURRING_API = "https://lite-api.jup.ag/recurring/v1";

export interface JupiterUnsignedOrderTx {
  order: string; // the order account pubkey
  transaction: string; // base64 unsigned transaction
  requestId?: string;
}

/**
 * Creates a Jupiter Trigger (price/limit) order: sell exactly makingAmount
 * of inputMint for at least takingAmount of outputMint, filled whenever
 * Jupiter's routing finds that price achievable — a real on-chain limit
 * order, not a synthetic one this app polls for. `maker`/`payer` are both
 * the connected Solana wallet's own address for every caller in this app
 * (no delegated/sponsored orders).
 */
export async function createTriggerOrder(params: {
  inputMint: string;
  outputMint: string;
  wallet: string;
  makingAmount: string; // atomic units of inputMint
  takingAmount: string; // atomic units of outputMint
  expiredAt?: string; // unix seconds, as a string
}): Promise<JupiterUnsignedOrderTx> {
  const res = await fetchWithTimeout(`${TRIGGER_API}/createOrder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      maker: params.wallet,
      payer: params.wallet,
      params: {
        makingAmount: params.makingAmount,
        takingAmount: params.takingAmount,
        ...(params.expiredAt ? { expiredAt: params.expiredAt } : {}),
      },
    }),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || body?.error) {
    throw new Error(typeof body?.error === "string" ? body.error : `Jupiter trigger createOrder failed (${res.status})`);
  }
  return { order: body.order, transaction: body.transaction, requestId: body.requestId };
}

export async function cancelTriggerOrder(params: { wallet: string; order: string }): Promise<{ transaction: string }> {
  const res = await fetchWithTimeout(`${TRIGGER_API}/cancelOrder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maker: params.wallet, order: params.order }),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || body?.error) {
    throw new Error(typeof body?.error === "string" ? body.error : `Jupiter trigger cancelOrder failed (${res.status})`);
  }
  return { transaction: body.transaction };
}

export interface JupiterTriggerOrderStatus {
  orderKey: string;
  status: string; // e.g. "Open", "Completed", "Cancelled" — passed through verbatim, Jupiter is the source of truth
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  createdAt: string;
}

/**
 * Live status for a wallet's trigger orders — Jupiter, not our DB, is
 * authoritative for whether/when an order filled (see trigger_orders
 * migration's doc comment).
 */
export async function getTriggerOrders(wallet: string, orderStatus: "active" | "history"): Promise<JupiterTriggerOrderStatus[]> {
  const url = new URL(`${TRIGGER_API}/getTriggerOrders`);
  url.searchParams.set("user", wallet);
  url.searchParams.set("orderStatus", orderStatus);
  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Jupiter getTriggerOrders failed (${res.status})`);
  const body = await res.json();
  return (body?.orders ?? []) as JupiterTriggerOrderStatus[];
}

/**
 * Creates a Jupiter Recurring (DCA) order — splits inAmount of inputMint
 * into numberOfOrders equal buys of outputMint, spaced intervalSeconds
 * apart. Live-verified minimum: each individual cycle must be worth at
 * least $50 (not the $10 figure some third-party docs quote — Jupiter's
 * own API rejected a $38/cycle order with an explicit "minimum is $50.00"
 * error during verification). Callers must validate
 * inAmount/numberOfOrders against a live USD estimate before calling this,
 * or surface Jupiter's own rejection message as-is.
 */
export async function createRecurringOrder(params: {
  inputMint: string;
  outputMint: string;
  wallet: string;
  inAmount: string; // atomic units of inputMint, TOTAL across all cycles
  numberOfOrders: number;
  intervalSeconds: number;
}): Promise<JupiterUnsignedOrderTx> {
  const res = await fetchWithTimeout(`${RECURRING_API}/createOrder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: params.wallet,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      params: {
        time: {
          inAmount: Number(params.inAmount),
          numberOfOrders: params.numberOfOrders,
          interval: params.intervalSeconds,
          minPrice: null,
          maxPrice: null,
          startAt: null,
        },
      },
    }),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || body?.error) {
    throw new Error(typeof body?.error === "string" ? body.error : `Jupiter recurring createOrder failed (${res.status})`);
  }
  return { order: body.recurringOrder ?? body.order, transaction: body.transaction, requestId: body.requestId };
}

export async function cancelRecurringOrder(params: { wallet: string; order: string }): Promise<{ transaction: string }> {
  const res = await fetchWithTimeout(`${RECURRING_API}/cancelOrder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: params.wallet, order: params.order, recurringType: "time" }),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || body?.error) {
    throw new Error(typeof body?.error === "string" ? body.error : `Jupiter recurring cancelOrder failed (${res.status})`);
  }
  return { transaction: body.transaction };
}

export interface JupiterRecurringOrderStatus {
  orderKey: string;
  status: string;
  inputMint: string;
  outputMint: string;
  inDeposited: string;
  inWithdrawn: string;
  outWithdrawn: string;
  createdAt: string;
}

export async function getRecurringOrders(wallet: string, orderStatus: "active" | "history" = "active"): Promise<JupiterRecurringOrderStatus[]> {
  const url = new URL(`${RECURRING_API}/getRecurringOrders`);
  url.searchParams.set("user", wallet);
  url.searchParams.set("recurringType", "time");
  url.searchParams.set("orderStatus", orderStatus);
  url.searchParams.set("includeFailedTx", "false");
  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Jupiter getRecurringOrders failed (${res.status})`);
  const body = await res.json();
  // Live-verified (2026-08-08): the response keys the order array by the
  // recurringType value ("time"), not a generic "orders" field like the
  // Trigger API — {user, orderStatus, time: [...], totalPages, ...}.
  return (body?.time ?? []) as JupiterRecurringOrderStatus[];
}
