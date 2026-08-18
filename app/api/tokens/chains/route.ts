import { NextResponse } from "next/server";
import { getRelayChains } from "@/lib/chains/relayChains";
import { SWAP_CHAINS, BTC_CHAIN_ID, SUI_CHAIN_INFO } from "@/lib/chains/swapChains";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Real bug found 2026-08-08b: this used to return getRelayChains() entirely
// unfiltered — Relay's real /chains lists 85+ chains, but this app only has
// actual execution support (RPC client, wallet integration, Jupiter/Relay/
// ChangeNOW routing) for the 7 in ALLOWED_CHAIN_IDS below. Every other
// chain was still shown as pickable in the token-select modal's sidebar,
// leading to a dead end: no balance fetch, no wallet to sign with, and
// (for the ~78 EVM-shaped ones) a Relay quote that would build fine but
// then fail at signing time since evmWallet.address only ever holds an
// address for the 6 EVM chains this app configures RPC clients for.
// Bitcoin is the one addition beyond SWAP_CHAINS — it DOES have real
// execution support now (ChangeNOW, see app/api/quote/btc/route.ts), just
// through a different engine than Relay.
const ALLOWED_CHAIN_IDS = new Set<number>([...SWAP_CHAINS.map((c) => c.chainId), BTC_CHAIN_ID]);

// Public market data — no auth required. Powers the token-select modal's
// left-hand chain list.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:chains"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const chains = (await getRelayChains()).filter((c) => ALLOWED_CHAIN_IDS.has(c.id));
    // Sui (2026-08-18) — appended, not filtered from Relay's list, since
    // Relay's /chains has no Sui entry at all (ChangeNOW is the execution
    // engine, same as Bitcoin, but Bitcoin's metadata happens to already be
    // in Relay's list while Sui's isn't) — see SUI_CHAIN_INFO's own doc.
    return NextResponse.json({ chains: [...chains, SUI_CHAIN_INFO] });
  } catch (err) {
    return safeErrorResponse("tokens/chains", err, 502);
  }
}
