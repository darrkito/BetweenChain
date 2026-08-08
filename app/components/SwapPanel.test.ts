import { describe, it, expect } from "vitest";
import { isBuyTokenAllowed } from "./SwapPanel";

const SOLANA_CHAIN_ID = 792703809;
const BASE_CHAIN_ID = 8453;
const ETHEREUM_CHAIN_ID = 1;
const BTC_CHAIN_ID = 8253038;

describe("isBuyTokenAllowed", () => {
  it("allows native SOL as a Buy target regardless of the Sell chain", () => {
    expect(isBuyTokenAllowed(BASE_CHAIN_ID, { chainId: SOLANA_CHAIN_ID, isNative: true })).toBe(true);
    expect(isBuyTokenAllowed(SOLANA_CHAIN_ID, { chainId: SOLANA_CHAIN_ID, isNative: true })).toBe(true);
  });

  it("allows a non-native Solana token as a Buy target when Sell is ALSO Solana (2026-08-07 fix — real user report: same-chain SPL<->SPL previously showed nothing)", () => {
    expect(isBuyTokenAllowed(SOLANA_CHAIN_ID, { chainId: SOLANA_CHAIN_ID, isNative: false })).toBe(true);
  });

  it("still blocks a non-native Solana token as a Buy target for a cross-chain-into-Solana destination — Relay only ever bridges native SOL onto Solana", () => {
    expect(isBuyTokenAllowed(BASE_CHAIN_ID, { chainId: SOLANA_CHAIN_ID, isNative: false })).toBe(false);
  });

  it("always allows any EVM token as a Buy target (same-chain or cross-chain, 2026-08-06 behavior unchanged)", () => {
    expect(isBuyTokenAllowed(SOLANA_CHAIN_ID, { chainId: BASE_CHAIN_ID, isNative: false })).toBe(true);
    expect(isBuyTokenAllowed(BASE_CHAIN_ID, { chainId: BASE_CHAIN_ID, isNative: false })).toBe(true);
    expect(isBuyTokenAllowed(1, { chainId: BASE_CHAIN_ID, isNative: false })).toBe(true);
  });

  describe("Bitcoin (2026-08-08b) — only ever paired with native SOL or native Ethereum ETH", () => {
    it("allows BTC as a Buy target when Sell is native SOL or native Ethereum ETH", () => {
      expect(isBuyTokenAllowed(SOLANA_CHAIN_ID, { chainId: BTC_CHAIN_ID, isNative: true })).toBe(true);
      expect(isBuyTokenAllowed(ETHEREUM_CHAIN_ID, { chainId: BTC_CHAIN_ID, isNative: true })).toBe(true);
    });

    it("blocks BTC as a Buy target from any other Sell chain (e.g. Base, Arbitrum — ChangeNOW support never verified for those)", () => {
      expect(isBuyTokenAllowed(BASE_CHAIN_ID, { chainId: BTC_CHAIN_ID, isNative: true })).toBe(false);
    });

    it("once Sell is BTC, only allows native SOL or native Ethereum ETH as a Buy target", () => {
      expect(isBuyTokenAllowed(BTC_CHAIN_ID, { chainId: SOLANA_CHAIN_ID, isNative: true })).toBe(true);
      expect(isBuyTokenAllowed(BTC_CHAIN_ID, { chainId: ETHEREUM_CHAIN_ID, isNative: true })).toBe(true);
      expect(isBuyTokenAllowed(BTC_CHAIN_ID, { chainId: BASE_CHAIN_ID, isNative: true })).toBe(false);
      expect(isBuyTokenAllowed(BTC_CHAIN_ID, { chainId: SOLANA_CHAIN_ID, isNative: false })).toBe(false);
    });
  });
});
