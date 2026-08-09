import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { checkAddressSecurity, checkTokenSecurity } from "@/lib/goplus/security";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 15;

// Burner Shield Lite (2026-08-09) — public, unauthenticated (this is a
// lookup against public GoPlus security data, nothing user-specific),
// rate-limited.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "burner-shield:check"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const chainId = Number(url.searchParams.get("chainId"));
  if (!address || !isAddress(address) || !chainId) return NextResponse.json({ error: "Invalid address or chain" }, { status: 400 });

  try {
    const [addressSecurity, tokenSecurity] = await Promise.all([
      checkAddressSecurity(chainId, address),
      checkTokenSecurity(chainId, address),
    ]);
    return NextResponse.json({ addressSecurity, tokenSecurity });
  } catch (err) {
    return safeErrorResponse("burner-shield/check", err, 502);
  }
}
