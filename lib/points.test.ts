import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { creditSwapPoints } from "./points";
import { supabaseAdmin } from "@/lib/supabase/server";

// Real integration tests against the local Supabase instance — same
// reasoning as lib/auth/siws.test.ts: creditSwapPoints already takes a
// SupabaseClient as a parameter (designed for exactly this), and the logic
// under test (idempotency via points_credited, referral-bonus splitting, the
// MIN_VOLUME_USD_FOR_POINTS dust floor) is real money math a mock could too
// easily get subtly wrong in a way that still passes.
//
// creditNftPurchasePoints (lib/points.ts) is structurally identical — same
// dust floor, same idempotency-via-points_credited, same referral split —
// against nft_purchases/nft_purchase_quotes instead of
// swap_quotes/swap_transactions. Not separately covered here: its fixture
// chain needs nft_purchase_quotes' several NOT NULL columns (vendor,
// listing details, chain slug, etc.) that would need their own careful
// setup for marginal extra confidence over what's already covered here on
// the identical logic. A reasonable follow-up, not done in this pass.
const hasLocalSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!hasLocalSupabase)("creditSwapPoints / creditNftPurchasePoints (real local Supabase)", () => {
  const db = supabaseAdmin();
  const createdUserIds: string[] = [];
  const createdInviteCodes: string[] = [];

  afterEach(async () => {
    // FK cascades (users -> swap_quotes/swap_transactions/points_ledger/
    // referrals/invite_codes, all "on delete cascade") handle almost
    // everything — invite_codes is the one table with no user-scoped FK back
    // to a *specific* row we tracked by id (its PK is the code itself), so
    // it's deleted explicitly.
    if (createdInviteCodes.length) {
      await db.from("invite_codes").delete().in("code", createdInviteCodes);
      createdInviteCodes.length = 0;
    }
    if (createdUserIds.length) {
      await db.from("users").delete().in("id", createdUserIds);
      createdUserIds.length = 0;
    }
  });

  async function makeUser(): Promise<string> {
    const { data, error } = await db
      .from("users")
      .insert({ solana_pubkey: `test-${randomBytes(12).toString("hex")}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`test setup failed: ${error?.message}`);
    createdUserIds.push(data.id);
    return data.id;
  }

  async function makeSwap(userId: string): Promise<string> {
    const { data: quote, error: quoteErr } = await db
      .from("swap_quotes")
      .insert({
        user_id: userId,
        source_chain: "solana",
        source_mint: "SOL",
        source_amount: 1,
        dest_chain: "solana",
        dest_token: "SOL",
        dest_address: "TestDestAddress11111111111111111111111111",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (quoteErr || !quote) throw new Error(`test setup failed: ${quoteErr?.message}`);

    const { data: swap, error: swapErr } = await db
      .from("swap_transactions")
      .insert({ quote_id: quote.id, user_id: userId })
      .select("id")
      .single();
    if (swapErr || !swap) throw new Error(`test setup failed: ${swapErr?.message}`);
    return swap.id;
  }

  async function pointsForUser(userId: string): Promise<Array<{ points: number; reason: string }>> {
    const { data } = await db.from("points_ledger").select("points, reason").eq("user_id", userId);
    return data ?? [];
  }

  it("credits floor(usdVolume) points for a swap with no referrer", async () => {
    const userId = await makeUser();
    const swapId = await makeSwap(userId);

    await creditSwapPoints(db, { swapId, userId, usdVolume: 42.9 });

    const rows = await pointsForUser(userId);
    expect(rows).toEqual([{ points: 42, reason: "swap_volume" }]); // Math.floor(42.9) = 42
  });

  it("DUST FLOOR: does nothing for usdVolume below MIN_VOLUME_USD_FOR_POINTS (no row inserted, swap not marked credited)", async () => {
    const userId = await makeUser();
    const swapId = await makeSwap(userId);

    await creditSwapPoints(db, { swapId, userId, usdVolume: 0.5 });

    expect(await pointsForUser(userId)).toEqual([]);
    const { data: swap } = await db.from("swap_transactions").select("points_credited").eq("id", swapId).single();
    expect(swap?.points_credited).toBe(false);
  });

  it("IDEMPOTENCY: calling twice for the same swap only credits points once", async () => {
    const userId = await makeUser();
    const swapId = await makeSwap(userId);

    await creditSwapPoints(db, { swapId, userId, usdVolume: 100 });
    await creditSwapPoints(db, { swapId, userId, usdVolume: 100 }); // simulates a retried confirmation webhook

    const rows = await pointsForUser(userId);
    expect(rows.filter((r) => r.reason === "swap_volume")).toHaveLength(1);
  });

  it("REFERRAL SPLIT: a referred user's swap credits both the referrer (20%) and the referred user's own bonus (10%), on top of their own base points", async () => {
    const referrerId = await makeUser();
    const referredId = await makeUser();

    const code = `test-${randomBytes(6).toString("hex")}`;
    createdInviteCodes.push(code);
    await db.from("invite_codes").insert({ code, owner_id: referrerId });
    await db.from("referrals").insert({ referred_user_id: referredId, referrer_user_id: referrerId, invite_code: code });

    const swapId = await makeSwap(referredId);
    await creditSwapPoints(db, { swapId, userId: referredId, usdVolume: 100 });

    const referredRows = await pointsForUser(referredId);
    expect(referredRows).toEqual(
      expect.arrayContaining([
        { points: 100, reason: "swap_volume" }, // Math.floor(100)
        { points: 10, reason: "referred_bonus" }, // 100 * REFERRED_BONUS (0.1)
      ]),
    );

    const referrerRows = await pointsForUser(referrerId);
    expect(referrerRows).toEqual([{ points: 20, reason: "referral_bonus" }]); // 100 * REFERRER_SHARE (0.2)
  });

  it("a swap with no referrer never credits a referral bonus to anyone", async () => {
    const userId = await makeUser();
    const swapId = await makeSwap(userId);

    await creditSwapPoints(db, { swapId, userId, usdVolume: 100 });

    const rows = await pointsForUser(userId);
    expect(rows.some((r) => r.reason === "referral_bonus" || r.reason === "referred_bonus")).toBe(false);
  });

  it("throws for a swap id that doesn't exist, rather than silently no-op'ing", async () => {
    const userId = await makeUser();
    await expect(creditSwapPoints(db, { swapId: "00000000-0000-0000-0000-000000000000", userId, usdVolume: 100 })).rejects.toThrow(
      "Swap not found",
    );
  });
});
