// Extracted from SwapPanel.tsx (2026-08-27) — PSI flagged the homepage loading
// ~50-80% unused JS in several chunks. Root cause: QuotePreviewWidget (rendered
// on the homepage, which has no wallet/swap-execution UI) imported these two
// pure allowlist functions from SwapPanel — a 699-line module that also pulls in
// generateFreshWallet (Solana/EVM keypair generation) and other swap-execution
// code the homepage never uses. Named imports don't guarantee tree-shaking away
// an entire coupled module, especially one with React hooks and side effects.
// Moving the pure logic here (zero React/wallet dependencies) lets the homepage
// bundle skip SwapPanel's module graph entirely. Behavior is unchanged — same
// functions, same logic, just relocated. Keep in sync with SwapPanel.tsx only
// if this logic itself needs to change, not for bundling reasons going forward.
import { BTC_CHAIN_ID, SUI_CHAIN_ID } from "@/lib/chains/swapChains";
import { CHANGENOW_ETH_NETWORK_BY_CHAIN_ID } from "@/lib/chains/changenowEvmNetworks";

const SOLANA_CHAIN_ID = 792703809;
const ETHEREUM_CHAIN_ID = 1;

function isNativeSolOrEth(t: { chainId: number; isNative: boolean }): boolean {
  return (t.chainId === SOLANA_CHAIN_ID || t.chainId === ETHEREUM_CHAIN_ID) && t.isNative;
}

export function isBuyTokenAllowed(sellChainId: number | undefined, t: { chainId: number; isNative: boolean }): boolean {
  if (t.chainId === BTC_CHAIN_ID || t.chainId === SUI_CHAIN_ID) {
    if (sellChainId === SOLANA_CHAIN_ID || sellChainId === ETHEREUM_CHAIN_ID) return true;
    return t.chainId === SUI_CHAIN_ID && sellChainId != null && sellChainId in CHANGENOW_ETH_NETWORK_BY_CHAIN_ID;
  }
  if (sellChainId === BTC_CHAIN_ID || sellChainId === SUI_CHAIN_ID) {
    return isNativeSolOrEth(t);
  }
  if (t.chainId === SOLANA_CHAIN_ID && !t.isNative) {
    return sellChainId === SOLANA_CHAIN_ID;
  }
  return true;
}

export function isSellTokenAllowedForBtcPair(buyChainId: number | undefined, t: { chainId: number; isNative: boolean }): boolean {
  if (buyChainId !== BTC_CHAIN_ID && buyChainId !== SUI_CHAIN_ID) return true; // not a ChangeNOW pair at all — unrestricted
  if (t.chainId === buyChainId) return false; // can't sell what you're buying (BTC/Sui chains each have exactly one token)
  if (t.chainId === BTC_CHAIN_ID || t.chainId === SUI_CHAIN_ID) return true;
  if (t.chainId === SOLANA_CHAIN_ID) return t.isNative; // ChangeNOW only ever handles native SOL, never an SPL token
  if (!t.isNative) return false; // ChangeNOW only ever handles each EVM chain's native ETH, never an ERC20
  if (t.chainId === ETHEREUM_CHAIN_ID) return true;
  return buyChainId === SUI_CHAIN_ID && t.chainId in CHANGENOW_ETH_NETWORK_BY_CHAIN_ID;
}
