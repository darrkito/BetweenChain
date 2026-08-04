import { NextResponse } from "next/server";
import { browseMagicEdenCollections } from "@/lib/nft/magiceden";
import { browseOpenSeaCollections } from "@/lib/nft/opensea";
import { browseTradeportCollections, isTradeportChain, TRADEPORT_CHAINS } from "@/lib/nft/tradeport";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

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
  const chainFamily = url.searchParams.get("chainFamily");
  const chain = url.searchParams.get("chain") ?? undefined; // OpenSea chain slug, e.g. "ethereum"

  try {
    if (chainFamily === "solana") {
      const collections = await browseMagicEdenCollections();
      return NextResponse.json({ collections });
    }

    if (chainFamily === "evm") {
      const collections = await browseOpenSeaCollections(chain);
      return NextResponse.json({ collections });
    }

    if (chainFamily === "move") {
      if (!chain || !isTradeportChain(chain)) {
        return NextResponse.json({ error: `chain query param must be one of: ${TRADEPORT_CHAINS.join(", ")}` }, { status: 400 });
      }
      const collections = await browseTradeportCollections(chain);
      return NextResponse.json({ collections });
    }

    return NextResponse.json({ error: "chainFamily query param must be one of: solana, evm, move" }, { status: 400 });
  } catch (err) {
    return safeErrorResponse("nft/collections", err, 502);
  }
}
