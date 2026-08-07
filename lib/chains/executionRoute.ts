// Fee-INDEPENDENT execution-route logic (2026-08-07) — which real engine(s)
// process a given swap shape, regardless of whether this app's own platform
// fee happens to be configured for that leg. Extracted out of lib/fees.ts's
// describeFeeLegs() (which mirrors app/api/quote/route.ts's own
// leg-selection exactly, gated by JUPITER_FEE_ACCOUNT/RELAY_FEE_RECIPIENT
// being set) — the underlying engine still executes the swap either way, so
// a route/execution-pathway display must NOT be fee-gated the way the fee
// breakdown display correctly is. Deliberately not "server-only" — used by
// both the server (app/api/quote/preview/route.ts, lib/fees.ts) and the
// client (app/components/RoutePathVisualizer.tsx) to describe the same
// route the server actually computes.
export interface ExecutionRouteLeg {
  label: string;
  engine: "jupiter" | "relay";
}

export function describeExecutionRoute(params: {
  isSolanaOrigin: boolean;
  /** Whether a real Jupiter conversion is actually needed — NOT simply
   * "source is native SOL" (that was the old, narrower field name/meaning,
   * valid back when a same-chain Solana destination could only ever be
   * native SOL itself). Since 2026-08-07 same-chain Solana can target any
   * SPL mint, so e.g. a native-SOL source swapping INTO an SPL token still
   * needs a real Jupiter leg despite the source being SOL — callers must
   * compute this as "does the source token differ from what's actually
   * being delivered," not just check the source mint in isolation. */
  needsJupiterLeg: boolean;
  isCrossChain: boolean;
}): ExecutionRouteLeg[] {
  const legs: ExecutionRouteLeg[] = [];
  if (params.isSolanaOrigin) {
    if (params.needsJupiterLeg) {
      legs.push({ label: "Jupiter (Solana conversion)", engine: "jupiter" });
    }
    if (params.isCrossChain) {
      legs.push({ label: "Relay (cross-chain delivery)", engine: "relay" });
    }
  } else {
    legs.push({ label: "Relay (swap & delivery)", engine: "relay" });
  }
  return legs;
}
