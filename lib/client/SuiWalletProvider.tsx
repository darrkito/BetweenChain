"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getWallets,
  isWalletWithRequiredFeatureSet,
  SUI_MAINNET_CHAIN,
  signAndExecuteTransaction as walletStandardSignAndExecute,
} from "@mysten/wallet-standard";
import type { WalletWithRequiredFeatures, WalletAccount } from "@mysten/wallet-standard";
import { registerSlushWallet } from "@mysten/slush-wallet";
import type { Transaction } from "@mysten/sui/transactions";

// Rewritten 2026-08-18 (perf pass) to go straight to Wallet Standard,
// replacing an @mysten/dapp-kit-based implementation — same architecture
// this app already uses for every OTHER chain (Solana: raw Wallet
// Standard via `wallets={[]}` in app/providers.tsx; EVM:
// lib/client/EvmWalletProvider.tsx hand-built on EIP-6963; BTC: the
// lighter sats-connect, not a heavy all-in-one SDK). dapp-kit was the one
// outlier, and empirically (esbuild bundle tests against this repo's real
// node_modules) almost all of its ~260-311KB minified weight was its own
// convenience layer (Radix UI dialogs for a connect modal this app never
// renders — it has its own ConnectWalletMenu.tsx — plus vanilla-extract
// CSS-in-JS and a React-Query-backed store), not the wallet protocol
// itself: @mysten/wallet-standard (discovery + connect + sign) +
// @mysten/slush-wallet (Slush web-wallet registration) together are
// ~109KB minified — the exact same low-level packages dapp-kit calls
// internally (confirmed by reading its source: useConnectWallet.ts is
// just `wallet.features['standard:connect'].connect()`;
// useSignAndExecuteTransaction.ts is wallet-standard's own signTransaction
// + a manual SuiClient.executeTransactionBlock call). Root cause this
// fixes: that ~1MB dapp-kit+@mysten/sui chunk was confirmed (via Next's
// own .next/diagnostics/route-bundle-stats.json) to load on EVERY route
// in this app, including pages that never touch Sui at all — this was
// the single largest remaining Lighthouse LCP blocker on /swap.
//
// Kept eager/synchronous at the same app/providers.tsx position the old
// dapp-kit version was — no lazy-loading needed at ~109KB (comparable to
// what EVM/BTC's own wallet code already costs), which also sidesteps a
// real React limitation a lazy-provider attempt hit earlier this session:
// conditionally mounting a Context.Provider ancestor remounts everything
// below it (reconciliation is type-and-position based, not "this wrapper
// is semantically transparent") — confirmed by a Playwright test catching
// a mid-interaction remount before it shipped.

const SUI_CHAIN_PREFIX = "sui:";
const SLUSH_WALLET_APP_NAME = "Blockchains.Click";

interface SuiWalletContextValue {
  wallets: WalletWithRequiredFeatures[];
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: (walletName: string) => Promise<string | null>;
  disconnect: () => void;
  signAndExecuteTransaction: (params: { transaction: Transaction }) => Promise<{ digest: string; effects: string }>;
}

const SuiWalletContext = createContext<SuiWalletContextValue | null>(null);

// Same asymmetry already fixed for Solana (ConnectWalletMenu.tsx's
// SOLANA_CONNECT_TIMEOUT_MS) and EVM (EvmWalletProvider.tsx's
// EVM_CONNECT_TIMEOUT_MS) — if the wallet's own approval popup never
// appears, `connect()` should fail with a real message instead of hanging
// the button on "Connecting…" forever.
const SUI_CONNECT_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

export function SuiWalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<WalletWithRequiredFeatures[]>([]);
  const [connectedWallet, setConnectedWallet] = useState<WalletWithRequiredFeatures | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<WalletAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventsOffRef = useRef<(() => void) | null>(null);

  // Slush web wallet (2026-07-22 originally) — its browser-extension/mobile
  // forms already auto-register via Wallet Standard, no code needed; the
  // WEB wallet (no-install, zkLogin/social login) needs this explicit
  // registration call. Exactly what dapp-kit's old `slushWallet` prop did
  // internally — called directly now instead of through the wrapper.
  useEffect(() => {
    registerSlushWallet(SLUSH_WALLET_APP_NAME);
  }, []);

  // Wallet Standard discovery — same event-driven "announce, don't poll"
  // shape as EvmWalletProvider.tsx's EIP-6963 listener, just the
  // chain-agnostic version already proven live in this exact app for
  // Solana (app/providers.tsx's `wallets={[]}` auto-detection).
  useEffect(() => {
    const api = getWallets();
    // isWalletWithRequiredFeatureSet is a real TS type guard (narrows to
    // WalletWithRequiredFeatures) — used instead of a plain cast so the
    // rest of this file's typing (standard:connect/events access below)
    // is checked for real, not asserted.
    const suiWallets = () =>
      api
        .get()
        .filter((w): w is WalletWithRequiredFeatures => isWalletWithRequiredFeatureSet(w))
        .filter((w) => w.chains.some((c) => c.startsWith(SUI_CHAIN_PREFIX)));
    // Deferred via Promise.resolve().then(...) — same pattern
    // ActivityDrawer.tsx/ThemeToggle.tsx use for this exact
    // set-state-in-effect lint rule.
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) setWallets(suiWallets());
    });
    const offRegister = api.on("register", () => setWallets(suiWallets()));
    const offUnregister = api.on("unregister", () => setWallets(suiWallets()));
    return () => {
      ignore = true;
      offRegister();
      offUnregister();
    };
  }, []);

  // Live account-change updates (switching accounts inside the extension,
  // or the extension itself revoking access) without a manual reconnect —
  // same role as dapp-kit's own internal `standard:events` subscription.
  const subscribeToWalletEvents = useCallback((wallet: WalletWithRequiredFeatures) => {
    eventsOffRef.current?.();
    eventsOffRef.current = null;
    const events = wallet.features["standard:events"];
    if (!events) return;
    eventsOffRef.current = events.on("change", (props) => {
      if (!props.accounts) return;
      const account = props.accounts.find((a) => a.chains.some((c) => c.startsWith(SUI_CHAIN_PREFIX))) ?? null;
      setConnectedAccount(account);
      if (!account) setConnectedWallet(null);
    });
  }, []);

  const connect = useCallback(
    async (walletName: string) => {
      const wallet = wallets.find((w) => w.name === walletName);
      const connectFeature = wallet?.features["standard:connect"];
      if (!wallet || !connectFeature) {
        setError("Wallet not found — it may have been uninstalled or disabled since this list was built.");
        return null;
      }
      setConnecting(true);
      setError(null);
      try {
        const result = await withTimeout(
          connectFeature.connect(),
          SUI_CONNECT_TIMEOUT_MS,
          `${wallet.name} didn't respond. Check for an approval popup that may have opened behind your browser window, or that your browser isn't blocking extension popups, then try again.`,
        );
        const account = result.accounts.find((a) => a.chains.some((c) => c.startsWith(SUI_CHAIN_PREFIX))) ?? null;
        if (!account) {
          setError(`${wallet.name} didn't authorize a Sui account.`);
          return null;
        }
        setConnectedWallet(wallet);
        setConnectedAccount(account);
        subscribeToWalletEvents(wallet);
        return account.address;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [wallets, subscribeToWalletEvents],
  );

  const disconnect = useCallback(() => {
    // Same "app-side state only" precedent as EvmWalletProvider.tsx —
    // standard:disconnect is best-effort cleanup, not a real revoke; the
    // wallet extension itself still considers the site authorized until
    // the user removes that permission there directly.
    connectedWallet?.features["standard:disconnect"]?.disconnect().catch(() => {});
    eventsOffRef.current?.();
    eventsOffRef.current = null;
    setConnectedWallet(null);
    setConnectedAccount(null);
    setError(null);
  }, [connectedWallet]);

  const signAndExecuteTransaction = useCallback(
    async ({ transaction }: { transaction: Transaction }) => {
      if (!connectedWallet || !connectedAccount) throw new Error("No Sui wallet connected");
      // Dynamic import (2026-08-18 perf pass) — this is the one place a
      // real RPC client is needed (Transaction#toJSON has to resolve gas
      // payment/object versions from the chain for an otherwise-unresolved
      // transfer transaction — confirmed by reading @mysten/sui's own
      // Transaction#build source before writing this). Deliberately NOT a
      // module-top import: this function is only ever called from
      // route-scoped code (SwapPageClient.tsx, NftBuyModalSui.tsx), never
      // from the global header, so keeping the import here instead of at
      // this file's top keeps @mysten/sui's client code out of the
      // globally-loaded chunk this whole rewrite exists to shrink.
      const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import("@mysten/sui/jsonRpc");
      const client = new SuiJsonRpcClient({
        url: process.env.NEXT_PUBLIC_SUI_RPC_URL ?? getJsonRpcFullnodeUrl("mainnet"),
        network: "mainnet",
      });
      const result = await walletStandardSignAndExecute(connectedWallet, {
        transaction: { toJSON: () => transaction.toJSON({ client }) },
        account: connectedAccount,
        chain: SUI_MAINNET_CHAIN,
      });
      return { digest: result.digest, effects: result.effects };
    },
    [connectedWallet, connectedAccount],
  );

  const value = useMemo(
    () => ({
      wallets,
      address: connectedAccount?.address ?? null,
      connecting,
      error,
      connect,
      disconnect,
      signAndExecuteTransaction,
    }),
    [wallets, connectedAccount, connecting, error, connect, disconnect, signAndExecuteTransaction],
  );

  return <SuiWalletContext.Provider value={value}>{children}</SuiWalletContext.Provider>;
}

export function useSuiWallet(): SuiWalletContextValue {
  const ctx = useContext(SuiWalletContext);
  if (!ctx) throw new Error("useSuiWallet must be used within a SuiWalletProvider");
  return ctx;
}
