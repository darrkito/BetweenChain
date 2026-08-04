import "server-only";
import { Connection } from "@solana/web3.js";

const RPC_TIMEOUT_MS = 10_000;

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
    // 2026-08-04 (API-hit reduction/reliability pass) — unlike viem's http
    // transport (which defaults to a 10s request timeout internally,
    // confirmed against its source), @solana/web3.js's Connection has no
    // built-in request timeout at all. A hung RPC call here would hit the
    // exact same "Vercel kills the function, client gets an empty non-JSON
    // body" failure mode lib/fetchWithTimeout.ts was built to close for the
    // NFT vendor clients — Connection's constructor accepts a custom
    // `fetch` function (confirmed via its own source), used here to inject
    // the same AbortSignal.timeout pattern.
    connection = new Connection(url, {
      commitment: "confirmed",
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
    });
  }
  return connection;
}
