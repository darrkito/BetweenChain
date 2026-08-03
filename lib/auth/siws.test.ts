import { describe, it, expect, afterEach } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import jwt from "jsonwebtoken";
import { Keypair } from "@solana/web3.js";
import { buildChallengeMessage, issueChallenge, verifyChallengeAndIssueSession, issueSessionToken, verifySessionToken } from "./siws";
import { supabaseAdmin } from "@/lib/supabase/server";

// buildChallengeMessage is pure — no DB/network needed.
describe("buildChallengeMessage", () => {
  it("embeds the exact nonce and pubkey passed in", () => {
    const msg = buildChallengeMessage("abc123", "SomePubkey111");
    expect(msg).toContain("Nonce: abc123");
    expect(msg).toContain("SomePubkey111");
  });

  it("REGRESSION GUARD: two calls with the same nonce/pubkey produce DIFFERENT messages, because each embeds its own `Issued At` timestamp — this is exactly why the app must persist and replay the FIRST issued message verbatim at verify time, never regenerate it (see this function's real historical bug, SECURITY.md's auth section: regenerating the message a second time during verification broke every login since the timestamp never matched)", async () => {
    const first = buildChallengeMessage("same-nonce", "same-pubkey");
    await new Promise((r) => setTimeout(r, 5)); // ensure a different ISO timestamp
    const second = buildChallengeMessage("same-nonce", "same-pubkey");
    expect(first).not.toBe(second);
  });
});

// issueSessionToken/verifySessionToken are pure JWT sign/verify — only need
// SUPABASE_JWT_SECRET set (loaded from .env.local by vitest.setup.ts).
describe("issueSessionToken / verifySessionToken", () => {
  it("round-trips userId and solanaPubkey", () => {
    const token = issueSessionToken("11111111-1111-1111-1111-111111111111", "SomeSolanaPubkey");
    const decoded = verifySessionToken(token);
    expect(decoded.userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(decoded.solanaPubkey).toBe("SomeSolanaPubkey");
  });

  it("round-trips a null solanaPubkey (the EVM-only standalone sign-in case)", () => {
    const token = issueSessionToken("22222222-2222-2222-2222-222222222222", null);
    const decoded = verifySessionToken(token);
    expect(decoded.solanaPubkey).toBeNull();
  });

  it("rejects a tampered token", () => {
    const token = issueSessionToken("11111111-1111-1111-1111-111111111111", "SomeSolanaPubkey");
    const tampered = token.slice(0, -4) + "XXXX";
    expect(() => verifySessionToken(tampered)).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    // Simulates a forged token — someone without SUPABASE_JWT_SECRET
    // couldn't produce a token verifySessionToken would accept.
    const forged = jwt.sign({ sub: "11111111-1111-1111-1111-111111111111", role: "authenticated" }, "wrong-secret");
    expect(() => verifySessionToken(forged)).toThrow();
  });
});

// Real integration tests against the local Supabase instance (already
// running for dev, same DB `next dev` itself uses) — deliberately NOT
// mocked. A hand-rolled fake of Supabase's chainable query builder risks
// giving false confidence (passes against a mock that doesn't actually
// match real Postgrest/RLS behavior) for exactly the kind of logic —
// single-use challenge consumption, expiry, signature verification — where
// that gap would matter most. Requires local Supabase running
// (`npx supabase start`) and NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// set in .env.local (loaded by vitest.setup.ts) — skips cleanly if unset.
const hasLocalSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!hasLocalSupabase)("verifyChallengeAndIssueSession (real local Supabase)", () => {
  const createdUserIds: string[] = [];
  // auth_challenges.solana_pubkey is a plain text column, NOT a foreign key
  // to users.id (a challenge can exist before any account does) — deleting
  // the user does NOT cascade-delete it, confirmed live (challenge rows were
  // still accumulating after users were correctly cleaned up). Tracked and
  // cleaned up separately.
  const createdPubkeys: string[] = [];

  afterEach(async () => {
    const db = supabaseAdmin();
    if (createdPubkeys.length) {
      await db.from("auth_challenges").delete().in("solana_pubkey", createdPubkeys);
      createdPubkeys.length = 0;
    }
    if (createdUserIds.length) {
      await db.from("users").delete().in("id", createdUserIds);
      createdUserIds.length = 0;
    }
  });

  function freshKeypair() {
    const keypair = Keypair.generate();
    createdPubkeys.push(keypair.publicKey.toBase58()); // tracked once, here, for every call site's cleanup
    return keypair;
  }

  function sign(message: string, keypair: Keypair): string {
    const sig = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
    return bs58.encode(sig);
  }

  it("a real signed challenge succeeds and mints a session", async () => {
    const keypair = freshKeypair();
    const pubkey = keypair.publicKey.toBase58();
    const { nonce, message } = await issueChallenge(pubkey);

    const result = await verifyChallengeAndIssueSession({
      solanaPubkey: pubkey,
      nonce,
      signatureBase58: sign(message, keypair),
    });

    expect(result.token).toBeTruthy();
    expect(result.userId).toBeTruthy();
    createdUserIds.push(result.userId);

    const decoded = verifySessionToken(result.token);
    expect(decoded.solanaPubkey).toBe(pubkey);
  });

  it("REPLAY PROTECTION: the exact same challenge cannot be verified a second time (single-use, consumed_at)", async () => {
    const keypair = freshKeypair();
    const pubkey = keypair.publicKey.toBase58();
    const { nonce, message } = await issueChallenge(pubkey);
    const signatureBase58 = sign(message, keypair);

    const first = await verifyChallengeAndIssueSession({ solanaPubkey: pubkey, nonce, signatureBase58 });
    createdUserIds.push(first.userId);

    await expect(verifyChallengeAndIssueSession({ solanaPubkey: pubkey, nonce, signatureBase58 })).rejects.toThrow(
      "Challenge not found, expired, or already used",
    );
  });

  it("rejects a valid-looking signature from the WRONG keypair (signature doesn't match the claimed pubkey)", async () => {
    const owner = freshKeypair();
    const impostor = freshKeypair();
    const { nonce, message } = await issueChallenge(owner.publicKey.toBase58());

    await expect(
      verifyChallengeAndIssueSession({
        solanaPubkey: owner.publicKey.toBase58(),
        nonce,
        signatureBase58: sign(message, impostor), // signed by the wrong key
      }),
    ).rejects.toThrow("Invalid signature");
  });

  it("rejects an expired challenge", async () => {
    const keypair = freshKeypair();
    const pubkey = keypair.publicKey.toBase58();
    const nonce = "expired-test-nonce";
    const message = buildChallengeMessage(nonce, pubkey);

    // Insert directly with an already-past expiry — same shape issueChallenge
    // would produce, just backdated, to test the expiry check deterministically
    // rather than waiting 5 real minutes.
    await supabaseAdmin()
      .from("auth_challenges")
      .insert({ solana_pubkey: pubkey, nonce, message, expires_at: new Date(Date.now() - 1000).toISOString() });

    await expect(
      verifyChallengeAndIssueSession({ solanaPubkey: pubkey, nonce, signatureBase58: sign(message, keypair) }),
    ).rejects.toThrow("Challenge not found, expired, or already used");
  });

  it("rejects a nonce that was never issued", async () => {
    const keypair = freshKeypair();
    const pubkey = keypair.publicKey.toBase58();
    const fakeMessage = buildChallengeMessage("never-issued-nonce", pubkey);

    await expect(
      verifyChallengeAndIssueSession({
        solanaPubkey: pubkey,
        nonce: "never-issued-nonce",
        signatureBase58: sign(fakeMessage, keypair),
      }),
    ).rejects.toThrow("Challenge not found, expired, or already used");
  });
});
