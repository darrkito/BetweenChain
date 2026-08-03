import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { isPlausibleEvmAddress } from "./validation";

// Regression coverage for the 2026-08-03 upgrade from a bare hex-format
// regex to viem's isAddress — confirmed live before switching that this
// preserves the old behavior for all-lowercase/uppercase addresses while
// adding real checksum validation for mixed-case ones (see lib/validation.ts's
// comment for the full reasoning).
describe("isPlausibleEvmAddress", () => {
  const realChecksummed = getAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");

  it("accepts a correctly checksummed mixed-case address", () => {
    expect(isPlausibleEvmAddress(realChecksummed)).toBe(true);
  });

  it("accepts an all-lowercase address (no checksum info present — common wallet/RPC output)", () => {
    expect(isPlausibleEvmAddress(realChecksummed.toLowerCase())).toBe(true);
  });

  it("rejects an all-uppercase-hex address — confirmed live this is NOT treated as \"no checksum info\" the way all-lowercase is; only all-lowercase is the recognized no-checksum form under EIP-55", () => {
    expect(isPlausibleEvmAddress("0x" + realChecksummed.slice(2).toUpperCase())).toBe(false);
  });

  it("rejects a mixed-case address whose casing does NOT match its real EIP-55 checksum — a plain hex regex would have silently accepted this", () => {
    // Deliberately flip the case of one letter from the real checksummed address.
    const corrupted = realChecksummed.replace("d", "D");
    expect(corrupted).not.toBe(realChecksummed);
    expect(isPlausibleEvmAddress(corrupted)).toBe(false);
  });

  it("rejects a string that's the wrong length", () => {
    expect(isPlausibleEvmAddress("0x1234")).toBe(false);
  });

  it("rejects a string missing the 0x prefix", () => {
    expect(isPlausibleEvmAddress(realChecksummed.slice(2))).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isPlausibleEvmAddress("0x" + "g".repeat(40))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isPlausibleEvmAddress("")).toBe(false);
  });
});
