import { NextResponse } from "next/server";
import { renderDustRecoveredOgImage } from "@/lib/seo/ogImage";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// Explicit — same known Turbopack+edge-runtime bug with next/og's
// ImageResponse the root-level opengraph-image.tsx already works around.
export const runtime = "nodejs";

// A plain API route rather than the opengraph-image.tsx file convention
// (used by every other OG image in this app) because this one needs
// arbitrary query-string params (amount/count) — Next's special image-file
// convention resolves off route segments (`params`), not searchParams, so
// a real dynamic route is the correct tool here. Stateless: the numbers
// come straight from the URL, no DB lookup, so this can regenerate the same
// image for the same link indefinitely with no expiry.
//
// Rate-limited (2026-08-08d security review) — a real gap this route had
// that no other new-this-session route did: unlike the blog/root
// opengraph-image.tsx routes (bounded by real, app-controlled slugs), this
// one accepts arbitrary amount/count query params, making it trivial to
// generate unlimited unique cache-busting URLs and force fresh Satori
// renders (real CPU cost) on every hit. Every other public route in this
// app already has this guard; this one just hadn't gotten it.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "dust-sweeper:share-image"), 30, 60_000);
  if (!rl.ok) return new NextResponse("Too many requests", { status: 429 });

  const url = new URL(req.url);
  const amountRaw = Number(url.searchParams.get("amount"));
  const countRaw = Number(url.searchParams.get("count"));
  const amountUsd = Number.isFinite(amountRaw) && amountRaw >= 0 ? amountRaw.toFixed(2) : "0.00";
  const tokenCount = Number.isFinite(countRaw) && countRaw >= 0 ? Math.round(countRaw) : 0;

  return renderDustRecoveredOgImage({ amountUsd, tokenCount });
}
