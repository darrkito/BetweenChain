"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider as MystenWalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import "@mysten/dapp-kit/dist/index.css";

// @mysten/dapp-kit is the official Mysten Labs SDK — auto-discovers any
// installed Sui-compatible wallet via the "Wallet Standard" protocol (the
// same discovery shape as EIP-6963 for EVM, or `wallets={[]}` + Wallet
// Standard already used for Solana in app/providers.tsx), including Sui
// Wallet/Phantom (Sui support) as browser extensions. No custom picker
// needed the way EvmConnectPicker.tsx builds one for EVM — dapp-kit's own
// useConnectWallet/useWallets hooks already expose every detected wallet by
// name, wired up in SuiConnectPicker.tsx.
//
// Slush (2026-07-22) — Mysten's own wallet, formerly "Sui Wallet"/"Stashed".
// The browser-extension/mobile forms already work automatically via Wallet
// Standard, no code needed. The WEB wallet (no-install, zkLogin/social
// login) is NOT auto-detected — it needs explicit registration, done here
// via WalletProvider's built-in `slushWallet` prop (confirmed live in
// @mysten/dapp-kit's own type definitions — no separate @mysten/slush-wallet
// package needed, that package is only for apps NOT already using
// dapp-kit). Per Mysten's own docs: if the user has the Slush extension
// installed, the connect modal shows just that; otherwise it falls back to
// the web wallet automatically.
const queryClient = new QueryClient();
const NETWORKS = {
  mainnet: { url: process.env.NEXT_PUBLIC_SUI_RPC_URL ?? getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" as const },
};

export function SuiWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={NETWORKS} defaultNetwork="mainnet">
        {/* autoConnect explicitly false — same reasoning as Solana's
            WalletProvider in app/providers.tsx (removed 2026-07-21): a silent
            reconnect attempt on page load can hang forever if the wallet has
            no trusted prior session for this origin, making a real click
            look like a no-op. Manual connect only, every time. */}
        <MystenWalletProvider autoConnect={false} slushWallet={{ name: "ChainBreak" }}>
          {children}
        </MystenWalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
