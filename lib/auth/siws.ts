import "server-only";
import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import jwt from "jsonwebtoken";
import { PublicKey } from "@solana/web3.js";
import { supabaseAdmin } from "@/lib/supabase/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes to sign
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 day session

export function buildChallengeMessage(nonce: string, pubkey: string): string {
  return [
    "SwapperBetweenChains wants you to sign in with your Solana account:",
    pubkey,
    "",
    "This request will not trigger a blockchain transaction or cost any gas.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

export async function issueChallenge(solanaPubkey: string): Promise<{ nonce: string; message: string }> {
  // Validate this is a real ed25519 pubkey before we ever store/sign anything for it.
  new PublicKey(solanaPubkey);

  const nonce = randomBytes(16).toString("hex");
  const message = buildChallengeMessage(nonce, solanaPubkey);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

  const { error } = await supabaseAdmin()
    .from("auth_challenges")
    .insert({ solana_pubkey: solanaPubkey, nonce, message, expires_at: expiresAt });
  if (error) throw new Error(`Failed to issue challenge: ${error.message}`);

  return { nonce, message };
}

export async function verifyChallengeAndIssueSession(params: {
  solanaPubkey: string;
  nonce: string;
  signatureBase58: string;
}): Promise<{ token: string; userId: string }> {
  const { solanaPubkey, nonce, signatureBase58 } = params;
  const db = supabaseAdmin();

  const { data: challenge, error: challengeErr } = await db
    .from("auth_challenges")
    .select("*")
    .eq("solana_pubkey", solanaPubkey)
    .eq("nonce", nonce)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeErr || !challenge) {
    throw new Error("Challenge not found, expired, or already used");
  }

  const signatureValid = nacl.sign.detached.verify(
    new TextEncoder().encode(challenge.message),
    bs58.decode(signatureBase58),
    new PublicKey(solanaPubkey).toBytes(),
  );
  if (!signatureValid) throw new Error("Invalid signature");

  // Single-use: consume the challenge immediately so it can't be replayed.
  await db.from("auth_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id);

  const { data: user, error: upsertErr } = await db
    .from("users")
    .upsert({ solana_pubkey: solanaPubkey }, { onConflict: "solana_pubkey" })
    .select("id")
    .single();
  if (upsertErr || !user) throw new Error(`Failed to upsert user: ${upsertErr?.message}`);

  return { token: issueSessionToken(user.id, solanaPubkey), userId: user.id };
}

// Shared by both SIWS (above) and the standalone EVM sign-in path
// (lib/auth/siwe.ts's verifyEvmChallengeAndSignIn) — a session's identity
// can now be anchored by either chain (see migration
// 0008_evm_standalone_signin.sql), so `solanaPubkey` is optional here.
export function issueSessionToken(userId: string, solanaPubkey: string | null): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("Missing SUPABASE_JWT_SECRET");

  // `sub` = our internal user id, so Postgres RLS's auth.uid() resolves to it
  // once this JWT is presented via supabaseForUser().
  return jwt.sign({ sub: userId, role: "authenticated", solana_pubkey: solanaPubkey }, secret, {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function verifySessionToken(token: string): { userId: string; solanaPubkey: string | null } {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("Missing SUPABASE_JWT_SECRET");
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  if (!decoded.sub) throw new Error("Malformed session token");
  return { userId: decoded.sub as string, solanaPubkey: (decoded.solana_pubkey as string | null) ?? null };
}
