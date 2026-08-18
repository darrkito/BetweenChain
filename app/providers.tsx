"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { EvmWalletProvider } from "@/lib/client/EvmWalletProvider";
import { SuiWalletProvider } from "@/lib/client/SuiWalletProvider";
import { BtcWalletProvider } from "@/lib/client/BtcWalletProvider";
import { AuthProvider } from "@/lib/client/AuthProvider";
import { ConnectWalletModalProvider } from "@/lib/client/ConnectWalletModalProvider";
// styles.css deliberately NOT imported here (2026-08-18 perf pass) — it
// carries a render-blocking `@import url(fonts.googleapis.com/...DM+Sans)`
// that used to load on EVERY page, even ones with zero WalletMultiButton
// on screen (confirmed via Lighthouse on /swap — DM Sans is never even
// used, this app's own type scale is Calistoga/IBM Plex Sans/JetBrains
// Mono). WalletModalProvider itself still needs to wrap the app (its
// context is a real runtime dependency of WalletMultiButton, used in the
// three NFT buy modals — see NftBuyModal.tsx/NftBuyModalSui.tsx/
// NftBuyModalMagicEden.tsx), but the CSS only styles that button's DOM and
// is now imported directly in those three files instead, alongside their
// existing dynamic() import of WalletMultiButton — same lazy chunk, no
// global cost.

// Deliberately NO explicit PhantomWalletAdapter/SolflareWalletAdapter here
// (removed 2026-07-21) — those connect via the legacy `window.solana`
// injection, which current Phantom/Solflare versions only provide when the
// extension is set as the browser's "default Solana wallet"; otherwise they
// register solely via the Wallet Standard and the legacy adapter's connect
// silently fails or shows as undetected. `@solana/wallet-adapter-react`
// (^0.15.35+) auto-detects any Wallet Standard wallet on its own — passing
// an empty `wallets` array is the current recommended pattern and does not
// depend on that legacy toggle at all. Root-caused live from a user report
// of "Phantom connect not working" on the NFT buy modal.
export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

  return (
    <ConnectionProvider endpoint={endpoint}>
      {/*
        autoConnect removed 2026-07-21: it fires a silent connect() to
        whatever wallet name is cached in localStorage the instant the page
        loads. If Phantom has no trusted prior session for this origin, that
        silent attempt hangs in "connecting" forever instead of failing —
        the wallet-adapter-react-ui button is disabled while `connecting`,
        so a real user click on Phantom does nothing (it looks stuck because
        it WAS already stuck, before the click). Root-caused live from a
        user report: MetaMask worked (no autoConnect step in its flow),
        Phantom didn't. Manual connect only, every time.
      */}
      <WalletProvider wallets={[]}>
        <WalletModalProvider>
          <EvmWalletProvider>
            <SuiWalletProvider>
              <BtcWalletProvider>
                <AuthProvider>
                  <ConnectWalletModalProvider>{children}</ConnectWalletModalProvider>
                </AuthProvider>
              </BtcWalletProvider>
            </SuiWalletProvider>
          </EvmWalletProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
