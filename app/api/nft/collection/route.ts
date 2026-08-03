import { NextResponse } from "next/server";
import { getMagicEdenCollection } from "@/lib/nft/magiceden";
import { getOpenSeaCollection } from "@/lib/nft/opensea";
import { getTradeportCollection, isTradeportChain, TRADEPORT_CHAINS } from "@/lib/nft/tradeport";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftVendor } from "@/lib/nft/types";

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

  try {
    // Tradeport branch added 2026-07-21 — this route previously had NO
    // Tradeport case at all (fell through to `undefined` -> 404), which
    // meant every Tradeport/Sui collection detail page was unreachable
    // regardless of anything else being wired up correctly.
    const collection =
      vendor === "magiceden"
        ? await getMagicEdenCollection(slug)
        : vendor === "opensea"
          ? await getOpenSeaCollection(slug)
          : vendor === "tradeport"
            ? await getTradeportCollection(chain, slug)
            : undefined;
    if (!collection) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    return NextResponse.json({ collection });
  } catch (err) {
    // Upstream vendor rate-limit (e.g. Magic Eden's 120 QPM/2 QPS public
    // cap, see lib/nft/magiceden.ts's fetchMagicEden) surfaces here as a
    // generic thrown Error with the status embedded in the message — no
    // structured error type exists for this yet. Map it to a real 503 with
    // copy the UI can show as "try again", not a raw vendor error string.
    const message = (err as Error).message;
    if (message.includes("429")) {
      return NextResponse.json(
        { error: "This marketplace is temporarily busy — please try again in a moment." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
