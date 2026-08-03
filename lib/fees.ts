import "server-only";

/**
 * Platform fee configuration. Two independent legs, two independent
 * mechanisms — see AGENTS.md/STATE.md for the full write-up:
 *
 * - Relay (cross-chain leg): `appFees` on the /quote request, paid to any
 *   EVM address, no setup required beyond having a recipient wallet. Active
 *   as soon as RELAY_FEE_RECIPIENT is set.
 * - Jupiter (Solana leg): `platformFeeBps` + `feeAccount` on /quote and
 *   /swap. `feeAccount` MUST be a token account for wrapped SOL (the only
 *   mint this leg ever outputs) created via Jupiter's Referral Program
 *   (referral.jup.ag) — a one-time manual step requiring a real wallet
 *   signature, which cannot be done from code. Inactive (no fee charged)
 *   until JUPITER_FEE_ACCOUNT is set.
 *
 * Both legs are fed by the same fee rate by default, but have independent
 * env vars in case they ever need to diverge.
 */

function bpsFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const RELAY_FEE_RECIPIENT = process.env.RELAY_FEE_RECIPIENT || undefined;
export const RELAY_FEE_BPS = bpsFromEnv("RELAY_FEE_BPS", 25); // 0.25% default

export const JUPITER_FEE_ACCOUNT = process.env.JUPITER_FEE_ACCOUNT || undefined;
export const JUPITER_FEE_BPS = bpsFromEnv("JUPITER_FEE_BPS", 25); // 0.25% default

export function relayAppFees(): Array<{ recipient: string; fee: string }> | undefined {
  return RELAY_FEE_RECIPIENT ? [{ recipient: RELAY_FEE_RECIPIENT, fee: String(RELAY_FEE_BPS) }] : undefined;
}
