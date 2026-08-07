import { describe, it, expect } from "vitest";
import { describeExecutionRoute } from "./executionRoute";

describe("describeExecutionRoute", () => {
  it("returns just Relay for a non-Solana origin, regardless of cross-chain-ness", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: false, sourceIsNativeSol: false, isCrossChain: false })).toEqual([
      { label: "Relay (swap & delivery)", engine: "relay" },
    ]);
    expect(describeExecutionRoute({ isSolanaOrigin: false, sourceIsNativeSol: false, isCrossChain: true })).toEqual([
      { label: "Relay (swap & delivery)", engine: "relay" },
    ]);
  });

  it("returns nothing for a same-chain native-SOL Solana swap (no Jupiter, no Relay)", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, sourceIsNativeSol: true, isCrossChain: false })).toEqual([]);
  });

  it("returns Relay only for a cross-chain native-SOL Solana swap", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, sourceIsNativeSol: true, isCrossChain: true })).toEqual([
      { label: "Relay (cross-chain delivery)", engine: "relay" },
    ]);
  });

  it("returns Jupiter only for a same-chain non-native Solana swap", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, sourceIsNativeSol: false, isCrossChain: false })).toEqual([
      { label: "Jupiter (Solana conversion)", engine: "jupiter" },
    ]);
  });

  it("returns Jupiter then Relay for a cross-chain non-native Solana swap", () => {
    expect(describeExecutionRoute({ isSolanaOrigin: true, sourceIsNativeSol: false, isCrossChain: true })).toEqual([
      { label: "Jupiter (Solana conversion)", engine: "jupiter" },
      { label: "Relay (cross-chain delivery)", engine: "relay" },
    ]);
  });

  it("is fee-independent: the Jupiter leg is present even though JUPITER_FEE_ACCOUNT is never referenced here", () => {
    // This is the real correctness gap the function exists to close — see
    // lib/fees.ts's describeFeeLegs, which DOES gate on that env var and
    // would hide this exact leg whenever the fee isn't configured.
    const route = describeExecutionRoute({ isSolanaOrigin: true, sourceIsNativeSol: false, isCrossChain: false });
    expect(route.some((leg) => leg.engine === "jupiter")).toBe(true);
  });
});
