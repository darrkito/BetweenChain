import "server-only";
import { describeExecutionRoute } from "@/lib/chains/executionRoute";

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

/**
 * Which fee legs actually apply to a given swap shape, for display in the
 * review step. Built on lib/chains/executionRoute.ts's describeExecutionRoute
 * (the same real leg-selection rules, mirroring app/api/quote/route.ts's own
 * logic exactly), then filtered to only the legs whose fee is actually
 * active (JUPITER_FEE_ACCOUNT / RELAY_FEE_RECIPIENT unset) — showing a fee
 * that won't really be charged would be worse than showing nothing. For a
 * fee-INDEPENDENT view of which engine executes the swap (e.g. a route/
 * execution-pathway display), use describeExecutionRoute directly instead —
 * this function is fee display only.
 */
export function describeFeeLegs(params: {
  isSolanaOrigin: boolean;
  needsJupiterLeg: boolean;
  isCrossChain: boolean;
}): Array<{ label: string; bps: number }> {
  return describeExecutionRoute(params)
    .filter((leg) => (leg.engine === "jupiter" ? Boolean(JUPITER_FEE_ACCOUNT) : Boolean(RELAY_FEE_RECIPIENT)))
    .map((leg) => ({ label: leg.label, bps: leg.engine === "jupiter" ? JUPITER_FEE_BPS : RELAY_FEE_BPS }));
}

/** Same as describeFeeLegs, plus a dollar amount per leg (approximated as
 * bps% of the destination USD value — the same approximation the fee is
 * actually charged against on both Jupiter's and Relay's side). Returns
 * `amountUsd: null` per leg when destAmountUsd itself is unknown (e.g. an
 * unsupported preview destination), so callers can render "—" instead of a
 * fabricated number. */
export function feeBreakdownWithAmounts(
  params: Parameters<typeof describeFeeLegs>[0],
  destAmountUsd: string | null,
): Array<{ label: string; bps: number; amountUsd: string | null }> {
  const destUsdNum = destAmountUsd !== null ? Number(destAmountUsd) : null;
  return describeFeeLegs(params).map((leg) => ({
    ...leg,
    amountUsd: destUsdNum !== null && Number.isFinite(destUsdNum) ? ((leg.bps / 10_000) * destUsdNum).toFixed(2) : null,
  }));
}
