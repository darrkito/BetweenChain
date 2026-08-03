import { isAddress } from "viem";

// Upgraded 2026-08-03 from a format-only regex (0x + 40 hex chars, no
// checksum check) to viem's `isAddress` — confirmed live behavior before
// switching: default (non-strict) mode accepts all-lowercase/all-uppercase
// addresses (no checksum information present, common wallet/RPC output) AND
// correctly-checksummed mixed-case addresses, but rejects mixed-case input
// whose casing doesn't match the real EIP-55 checksum (a typo/corruption a
// plain hex regex would have silently accepted). Real destination addresses
// flow through this before an NFT purchase or swap destination is locked in
// (see lib/nft/purchase/quote and app/api/quote), so catching a
// checksum-mismatched paste error here — before funds move — is worth the
// stricter check.
export function isPlausibleEvmAddress(address: string): boolean {
  return isAddress(address);
}
