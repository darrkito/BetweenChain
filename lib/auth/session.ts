import "server-only";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth/siws";

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "sbc_session";

// solanaPubkey is nullable since migration 0008_evm_standalone_signin.sql —
// a session can now be anchored purely by a verified EVM address with no
// Solana wallet involved at all. Any route that genuinely needs a Solana
// signer (swap quote/execute, anything spending from a Solana wallet) must
// check for null itself and return a clear error, not assume it's always
// present.
export async function requireSession(): Promise<{ userId: string; solanaPubkey: string | null; token: string }> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new SessionError("No session cookie");
  try {
    const { userId, solanaPubkey } = verifySessionToken(token);
    return { userId, solanaPubkey, token };
  } catch {
    throw new SessionError("Invalid or expired session");
  }
}

// For routes that need a Solana-anchored session specifically (they sign or
// verify a Solana transaction) — fails clearly for an EVM-only session
// instead of silently passing `null` through as if it were a valid pubkey.
export async function requireSolanaSession(): Promise<{ userId: string; solanaPubkey: string; token: string }> {
  const session = await requireSession();
  if (!session.solanaPubkey) throw new SessionError("This action requires a Solana wallet — sign in with Solana to continue.");
  return { userId: session.userId, solanaPubkey: session.solanaPubkey, token: session.token };
}

export class SessionError extends Error {}
