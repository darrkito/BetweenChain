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

// Format-only (no checksum/network validation the way isPlausibleEvmAddress
// has via EIP-55) — covers the three real Bitcoin address formats a
// sats-connect wallet can return: legacy P2PKH ("1..."), P2SH ("3..."),
// and native segwit/bech32 ("bc1..."). Same role as isPlausibleEvmAddress:
// a cheap sanity check on a destination address before it's bound into a
// quote, not a substitute for ChangeNOW's own validation when the exchange
// is actually created.
const BTC_LEGACY_OR_P2SH = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BTC_BECH32 = /^bc1[a-z0-9]{25,62}$/;

export function isPlausibleBtcAddress(address: string): boolean {
  return BTC_LEGACY_OR_P2SH.test(address) || BTC_BECH32.test(address);
}
