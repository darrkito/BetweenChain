import { NextResponse } from "next/server";
import { NFT_VENDOR_CLIENTS, isTradeportChain, TRADEPORT_CHAINS } from "@/lib/nft/vendorClients";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftVendor } from "@/lib/nft/types";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Single-collection detail, powers the collection page header. `vendor` and
// `slug` come from the collection card the user clicked (see
// app/api/nft/collections/route.ts) — never re-derived from a free-text
// slug, since slugs are only meaningful within their own vendor's namespace.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "nft:collection"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor") as NftVendor | null;
  const slug = url.searchParams.get("slug");
  // Tradeport chain, mirrors app/api/nft/listings/route.ts's default. Validated
  // (not just cast) — this app-only lib/nft/tradeport.ts value is interpolated
  // directly into a GraphQL query string, see TRADEPORT_CHAINS's export comment.
  const rawChain = url.searchParams.get("chain");
  if (rawChain != null && !isTradeportChain(rawChain)) {
    return NextResponse.json({ error: `chain query param must be one of: ${TRADEPORT_CHAINS.join(", ")}` }, { status: 400 });
  }
  const chain = rawChain ?? "sui";
  if (!vendor || !slug) {
    return NextResponse.json({ error: "vendor and slug query params are required" }, { status: 400 });
  }
  const client = NFT_VENDOR_CLIENTS[vendor];
  if (!client) return NextResponse.json({ error: `Unknown vendor: ${vendor}` }, { status: 400 });

  try {
    const collection = await client.getCollection(slug, chain);
    if (!collection) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    return NextResponse.json({ collection });
  } catch (err) {
    // Upstream vendor rate-limit (e.g. Magic Eden's 120 QPM/2 QPS public
    // cap, see lib/nft/magiceden.ts's fetchMagicEden) surfaces here as a
    // generic thrown Error with the status embedded in the message — no
    // structured error type exists for this yet. Map it to a real 503 with
    // copy the UI can show as "try again", not a raw vendor error string.
    // TimeoutError (2026-08-04, added alongside lib/fetchWithTimeout.ts)
    // is the same user-facing situation — a hung/slow vendor — gets the same
    // friendly copy rather than the raw "operation was aborted" message.
    const err_ = err as Error;
    if (err_.message.includes("429") || err_.name === "TimeoutError") {
      return NextResponse.json(
        { error: "This marketplace is temporarily busy — please try again in a moment." },
        { status: 503 },
      );
    }
    return safeErrorResponse("nft/collection", err, 502);
  }
}
