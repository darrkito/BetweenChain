import { NextResponse } from "next/server";
import { getGame } from "@/lib/content/games";
import { incrementPlayCount } from "@/lib/games/plays";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Called once from GamePlayer.tsx the moment the user actually starts
// playing (iframe onLoad fires, or the external-launch button is clicked) —
// never on page view, so the count can't be trivially inflated by
// pageviews alone. Unauthenticated (a wallet session isn't required to play
// a game) but rate-limited per IP, same defensive posture as every other
// public counter-shaped route in this app.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const rl = await rateLimit(clientKey(req, "games:play"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { slug } = await params;
  if (!getGame(slug)) return NextResponse.json({ error: "Unknown game" }, { status: 404 });

  try {
    await incrementPlayCount(slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse("games/play", err, 502);
  }
}
