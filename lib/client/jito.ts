"use client";

import type { VersionedTransaction } from "@solana/web3.js";

// MEV Shield (2026-08-09, Solana-only) — Jito's Block Engine, confirmed
// live via direct curl before building (see
// PLAN_ROUTE_QUALITY_FEATURES.md): both sendBundle and sendTransaction
// respond to unauthenticated requests with real validation errors, not
// 401/403 — no API key, no partnership needed. Submits an ALREADY-SIGNED
// transaction (the same object this app already gets back from
// signTransaction()) directly to Jito's private relay instead of the
// public RPC's sendRawTransaction, so a sandwich bot watching the public
// mempool never sees it before it lands.
//
// Deliberately does NOT append a tip instruction in v1 — Jito's own docs
// confirm a tip is OPTIONAL for the single-transaction sendTransaction
// endpoint (only sendBundle requires one), just improves priority/
// inclusion odds under contention. Injecting a tip instruction into an
// already-built transaction (e.g. Jupiter's own compiled swap tx, which
// may reference address lookup tables) means decompiling and recompiling
// the message — real, but genuinely more machinery than v1's honest scope
// needs. Logged as a real, scoped follow-up.
const JITO_SEND_TX_ENDPOINT = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";

export async function sendViaJito(signedTx: VersionedTransaction): Promise<string> {
  const serialized = Buffer.from(signedTx.serialize()).toString("base64");
  const res = await fetch(JITO_SEND_TX_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [serialized, { encoding: "base64" }] }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "Jito submission failed");
  return body.result as string; // real tx signature, same shape as connection.sendRawTransaction's return
}
