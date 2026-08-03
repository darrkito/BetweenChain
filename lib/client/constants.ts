export const SOLANA_CHAIN_ID_CLIENT = 792703809; // must match lib/chains/relay.ts SOLANA_CHAIN_ID

// Wrapped SOL mint — what Jupiter/our backend mean by "native SOL" (must
// match lib/chains/jupiter.ts NATIVE_SOL_MINT).
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

// Relay represents native SOL with the System Program sentinel address
// instead — confirmed live during planning (`GET /chains` -> currency.address
// for chainId 792703809). Any token picked from the token-select modal with
// this address on the Solana chain must be translated to WRAPPED_SOL_MINT
// before being sent to /api/quote, or the Jupiter leg receives an invalid
// input mint.
export const RELAY_NATIVE_SOL_SENTINEL = "11111111111111111111111111111111";

// Must match lib/chains/relay.ts RELAY_NATIVE_EVM_SENTINEL — used by
// NftBuyModal's same-chain path to request a native-ETH quote with no Relay
// leg at all.
export const RELAY_NATIVE_EVM_SENTINEL = "0x0000000000000000000000000000000000000000";

export function normalizeSolanaSourceMint(address: string): string {
  return address === RELAY_NATIVE_SOL_SENTINEL ? WRAPPED_SOL_MINT : address;
}
