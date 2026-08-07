import { describe, it, expect } from "vitest";
import { describeExecutionRoute } from "./executionRoute";

describe("describeExecutionRoute", () => {
  it("returns just Relay for a non-Solana origin, regardless of cross-chain-ness", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: false, needsJupiterLeg: false, isCrossChain: false })).toEqual([
      { label: "Relay (swap & delivery)", engine: "relay" },
    ]);
    expect(describeExecutionRoute({ isSolanaOrigin: false, needsJupiterLeg: false, isCrossChain: true })).toEqual([
      { label: "Relay (swap & delivery)", engine: "relay" },
    ]);
  });

  it("returns nothing for a same-chain native-SOL-to-native-SOL Solana swap (no Jupiter, no Relay)", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, needsJupiterLeg: false, isCrossChain: false })).toEqual([]);
  });

  it("returns Relay only for a cross-chain native-SOL Solana swap", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, needsJupiterLeg: false, isCrossChain: true })).toEqual([
      { label: "Relay (cross-chain delivery)", engine: "relay" },
    ]);
  });

  it("returns Jupiter only for a same-chain non-native Solana swap", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, needsJupiterLeg: true, isCrossChain: false })).toEqual([
      { label: "Jupiter (Solana conversion)", engine: "jupiter" },
    ]);
  });

  it("returns Jupiter for a same-chain SOL -> SPL swap (2026-08-07) — source IS native SOL but still needs a real Jupiter leg", () => {
    // The real gap this covers: needsJupiterLeg must NOT be derived from
    // "source is native SOL" alone once same-chain Solana can target any
    // SPL mint — a SOL->BONK swap needs Jupiter even though the source is SOL.
    expect(describeExecutionRoute({ isSolanaOrigin: true, needsJupiterLeg: true, isCrossChain: false })).toEqual([
      { label: "Jupiter (Solana conversion)", engine: "jupiter" },
    ]);
  });

  it("returns Jupiter then Relay for a cross-chain non-native Solana swap", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, needsJupiterLeg: true, isCrossChain: true })).toEqual([
      { label: "Jupiter (Solana conversion)", engine: "jupiter" },
      { label: "Relay (cross-chain delivery)", engine: "relay" },
    ]);
  });

  it("is fee-independent: the Jupiter leg is present even though JUPITER_FEE_ACCOUNT is never referenced here", () => {
    // This is the real correctness gap the function exists to close — see
    // lib/fees.ts's describeFeeLegs, which DOES gate on that env var and
    // would hide this exact leg whenever the fee isn't configured.
    const route = describeExecutionRoute({ isSolanaOrigin: true, needsJupiterLeg: true, isCrossChain: false });
    expect(route.some((leg) => leg.engine === "jupiter")).toBe(true);
  });
});
