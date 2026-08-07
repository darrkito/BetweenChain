import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

// Real, minimal play-count persistence (2026-08-07) — separate from
// @vercel/analytics' track() events (also used for the same funnel).
// Analytics data is dashboard-only, not queryable back into this app; a
// number actually rendered on a game card needs its own row here. Read
// failures degrade to an empty map (never fabricated counts) — used for
// "Most Popular" sort and the count shown on a card, neither critical-path.
export async function getPlayCounts(): Promise<Record<string, number>> {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("game_plays").select("game_slug, play_count");
    if (error || !data) return {};
    return Object.fromEntries(data.map((r) => [r.game_slug as string, r.play_count as number]));
  } catch {
    return {};
  }
}

// Atomic (see the 0017 migration's increment_game_play_count function) —
// called once the user actually starts playing (iframe loaded, or the
// external-launch button clicked), not on page view, so the number can't be
// trivially inflated by pageviews alone.
export async function incrementPlayCount(slug: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.rpc("increment_game_play_count", { p_slug: slug });
  if (error) throw new Error(error.message);
}
