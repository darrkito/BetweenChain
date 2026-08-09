import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getAaveHealth, AAVE_SUPPORTED_CHAIN_IDS } from "@/lib/aave/healthFactor";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 20;

// Sentinel Shield (2026-08-09, read-only v1) — public, unauthenticated
// (health factor is public on-chain data, same "no secret to protect"
// reasoning as this app's other price-preview routes), rate-limited.
// Deliberately Aave-only in v1 — Kamino (Solana) and Navi (Sui) each need
// their own separate protocol integration, not built this pass.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "sentinel-shield:health"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });

  try {
    const snapshots = await Promise.all(AAVE_SUPPORTED_CHAIN_IDS.map((chainId) => getAaveHealth(chainId, address).catch(() => null)));
    return NextResponse.json({ snapshots: snapshots.filter((s) => s !== null) });
  } catch (err) {
    return safeErrorResponse("sentinel-shield/health", err, 502);
  }
}
