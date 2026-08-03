import "server-only";
import { randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import { supabaseAdmin } from "@/lib/supabase/server";
import { issueSessionToken } from "@/lib/auth/siws";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes to sign, same as SIWS

export function buildEvmChallengeMessage(nonce: string, address: string, standalone: boolean): string {
  return [
    standalone
      ? "SwapperBetweenChains wants you to sign in with your Ethereum account:"
      : "SwapperBetweenChains wants you to link this Ethereum account:",
    address,
    "",
    "This request will not trigger a blockchain transaction or cost any gas.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

/**
 * `userId` present = link mode (attach onto an already-signed-in Solana
 * session, migration 0007_evm_link.sql). `userId` omitted = standalone mode
 * (a brand-new-or-returning EVM-only sign-in, migration
 * 0008_evm_standalone_signin.sql) — the challenge has no user yet; verify()
 * finds-or-creates one by evm_verified_address.
 */
export async function issueEvmChallenge(evmAddress: string, userId?: string): Promise<{ nonce: string; message: string }> {
  const nonce = randomBytes(16).toString("hex");
  const message = buildEvmChallengeMessage(nonce, evmAddress, !userId);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

  const { error } = await supabaseAdmin()
    .from("evm_auth_challenges")
    .insert({ user_id: userId ?? null, evm_address: evmAddress, nonce, message, expires_at: expiresAt });
  if (error) throw new Error(`Failed to issue EVM challenge: ${error.message}`);

  return { nonce, message };
}

export async function verifyEvmChallengeAndLink(params: {
  userId: string;
  evmAddress: string;
  nonce: string;
  signatureHex: string;
}): Promise<void> {
  const { userId, evmAddress, nonce, signatureHex } = params;
  const db = supabaseAdmin();

  const { data: challenge, error: challengeErr } = await db
    .from("evm_auth_challenges")
    .select("*")
    .eq("user_id", userId)
    .eq("evm_address", evmAddress)
    .eq("nonce", nonce)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeErr || !challenge) {
    throw new Error("Challenge not found, expired, or already used");
  }

  const valid = await verifyMessage({
    address: evmAddress as `0x${string}`,
    message: challenge.message,
    signature: signatureHex as `0x${string}`,
  });
  if (!valid) throw new Error("Invalid signature");

  await db.from("evm_auth_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id);

  // A real, common sequence: someone signs in with Ethereum standalone
  // (migration 0008) BEFORE ever connecting Solana, creating an EVM-only
  // account with this exact address — then later also connects + signs in
  // with Solana in the same browser, which mints a second, unrelated
  // account (SIWS upserts by solana_pubkey alone, no idea it's the same
  // person). Linking from that second session then collides on this
  // address. If the existing claimant has NO Solana pubkey of its own, it
  // can only be that orphan (a genuine second real identity would have its
  // own Solana pubkey too) — merge it onto this session's user instead of
  // rejecting. Confirmed live 2026-07-21, see migration
  // 0010_evm_link_merge.sql for the full incident.
  const { data: existingClaimant } = await db
    .from("users")
    .select("id, solana_pubkey")
    .eq("evm_verified_address", evmAddress)
    .neq("id", userId)
    .maybeSingle();

  if (existingClaimant && !existingClaimant.solana_pubkey) {
    const { error: mergeErr } = await db.rpc("merge_evm_orphan_into_user", { orphan_id: existingClaimant.id, keeper_id: userId });
    if (mergeErr) throw new Error(`Failed to merge orphaned EVM account: ${mergeErr.message}`);
  } else if (existingClaimant) {
    // A real second identity (has its own Solana pubkey) — genuine
    // conflict, not safe to auto-merge two potentially-different people.
    throw new Error("This Ethereum address is already linked to a different account");
  }

  const { error: updateErr } = await db.from("users").update({ evm_verified_address: evmAddress }).eq("id", userId);
  if (updateErr) {
    // Race-condition safety net — the pre-check above isn't atomic with
    // this update, so a concurrent link attempt could still land in
    // between. Rare enough that surfacing the raw conflict is fine.
    if (updateErr.code === "23505") throw new Error("This Ethereum address is already linked to a different account");
    throw new Error(`Failed to link EVM address: ${updateErr.message}`);
  }
}

/**
 * Standalone EVM sign-in — no existing session required. Finds an existing
 * user already anchored by this evm_verified_address, or creates a brand
 * new one. Mints and returns a real session token either way (same JWT
 * shape SIWS uses, via issueSessionToken), so an EVM-only user gets a fully
 * working session with `solanaPubkey: null` — see migration
 * 0008_evm_standalone_signin.sql.
 */
export async function verifyEvmChallengeAndSignIn(params: {
  evmAddress: string;
  nonce: string;
  signatureHex: string;
}): Promise<{ token: string; userId: string }> {
  const { evmAddress, nonce, signatureHex } = params;
  const db = supabaseAdmin();

  const { data: challenge, error: challengeErr } = await db
    .from("evm_auth_challenges")
    .select("*")
    .eq("evm_address", evmAddress)
    .eq("nonce", nonce)
    .is("user_id", null)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeErr || !challenge) {
    throw new Error("Challenge not found, expired, or already used");
  }

  const valid = await verifyMessage({
    address: evmAddress as `0x${string}`,
    message: challenge.message,
    signature: signatureHex as `0x${string}`,
  });
  if (!valid) throw new Error("Invalid signature");

  await db.from("evm_auth_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id);

  const { data: user, error: upsertErr } = await db
    .from("users")
    .upsert({ evm_verified_address: evmAddress }, { onConflict: "evm_verified_address" })
    .select("id, solana_pubkey")
    .single();
  if (upsertErr || !user) throw new Error(`Failed to upsert user: ${upsertErr?.message}`);

  return { token: issueSessionToken(user.id, user.solana_pubkey), userId: user.id };
}
