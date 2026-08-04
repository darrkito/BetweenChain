import { NextResponse } from "next/server";
import { NFT_VENDOR_CLIENTS, VENDOR_FOR_FAMILY, isTradeportChain, TRADEPORT_CHAINS } from "@/lib/nft/vendorClients";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";
import type { NftChainFamily } from "@/lib/nft/types";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 30;

// Public market data — no auth required, mirrors app/api/tokens/list/route.ts.
// Routes to whichever vendor covers the requested chain family (no single
// vendor spans more than one — see PLAN.md's "Multichain NFT section").
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "nft:collections"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const chainFamily = url.searchParams.get("chainFamily") as NftChainFamily | null;
  const chain = url.searchParams.get("chain") ?? undefined; // OpenSea chain slug, e.g. "ethereum"; required+validated below for "move"

  if (!chainFamily || !(chainFamily in VENDOR_FOR_FAMILY)) {
    return NextResponse.json({ error: "chainFamily query param must be one of: solana, evm, move" }, { status: 400 });
  }
  // "move" is the one family with a real, required chain param (Tradeport
  // spans Sui/Aptos/Movement, no default makes sense) — solana/evm ignore
  // `chain` entirely (Magic Eden) or default it themselves (OpenSea).
  if (chainFamily === "move" && (!chain || !isTradeportChain(chain))) {
    return NextResponse.json({ error: `chain query param must be one of: ${TRADEPORT_CHAINS.join(", ")}` }, { status: 400 });
  }

  try {
    const client = NFT_VENDOR_CLIENTS[VENDOR_FOR_FAMILY[chainFamily]];
    const collections = await client.browseCollections(chain);
    return NextResponse.json({ collections });
  } catch (err) {
    return safeErrorResponse("nft/collections", err, 502);
  }
}
