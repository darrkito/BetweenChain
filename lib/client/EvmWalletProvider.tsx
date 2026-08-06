"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, createPublicClient, custom, type Hex, type EIP1193Provider } from "viem";

interface RelayEvmStep {
  from: string;
  to: string;
  data: string;
  value?: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

// EIP-6963 ("Multi Injected Provider Discovery") — the standard fix for
// exactly the bug this replaced (2026-07-21): more than one installed
// extension can register itself as `window.ethereum` (Phantom ships its own
// EVM support alongside Solana; Coinbase Wallet, Rabby, Brave Wallet all do
// the same), and whichever one wins that race silently hijacks every dapp
// that blindly trusts the single global — a real user report confirmed
// clicking this app's old generic "Browser wallet" button was actually
// landing on Phantom's EVM provider, not MetaMask, with no way to tell
// which one would win ahead of time. EIP-6963 lets every installed wallet
// announce itself independently (name/icon/rdns + its own isolated
// provider object), so the UI can list them by name and connect to the
// SPECIFIC one the user picks — exactly the same problem `wallets={[]}` +
// Wallet Standard already solves for Solana in app/providers.tsx.
interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EIP1193Provider;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<Eip6963ProviderDetail>;
  }
}

interface EvmWalletContextValue {
  providers: Eip6963ProviderInfo[];
  address: string | null;
  connectedProviderUuid: string | null;
  connecting: boolean;
  error: string | null;
  connect: (providerUuid: string, desiredChainId?: number) => Promise<string | null>;
  disconnect: () => void;
  ensureChain: (chainId: number) => Promise<void>;
  sendStepAndWait: (step: RelayEvmStep) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
}

const EvmWalletContext = createContext<EvmWalletContextValue | null>(null);

// Same asymmetry the Solana connect path already had fixed (see
// ConnectWalletMenu.tsx's SOLANA_CONNECT_TIMEOUT_MS) — this one was still
// missing here: if the wallet's own approval popup never appears (opened
// off-screen, blocked, or the extension just never responds),
// `requestAddresses()` hangs forever with `connecting` stuck `true` and no
// error ever shown — reads as "the connect button doesn't do anything."
const EVM_CONNECT_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/**
 * Shared app-wide EVM wallet state — a context (not a page-local hook) so a
 * single "Connect Wallet" entry point in AppHeader can drive connection
 * state for every consumer (swap page's Sell side, the NFT buy modal).
 * `disconnect()` here only clears this app's own local state — injected
 * EVM providers have no standard programmatic "revoke" API, so the
 * extension itself still considers the site connected until the user
 * removes that permission there directly. Account/session identity stays
 * Solana-anchored regardless (see STATE.md 2026-07-18i) — this is purely a
 * signing tool.
 */
export function EvmWalletProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<Eip6963ProviderInfo[]>([]);
  const providerMapRef = useRef<Map<string, EIP1193Provider>>(new Map());
  const activeProviderRef = useRef<EIP1193Provider | null>(null);

  const [address, setAddress] = useState<string | null>(null);
  const [connectedProviderUuid, setConnectedProviderUuid] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onAnnounce(event: CustomEvent<Eip6963ProviderDetail>) {
      const { info, provider } = event.detail;
      providerMapRef.current.set(info.uuid, provider);
      setProviders((prev) => (prev.some((p) => p.uuid === info.uuid) ? prev : [...prev, info]));
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  const connect = useCallback(async (providerUuid: string, desiredChainId?: number) => {
    // Fallback path for the rare wallet that still only does the legacy
    // `window.ethereum` injection and never announces via EIP-6963 — matches
    // this app on a single-wallet browser the same way it always did.
    const provider = providerUuid === "legacy" ? window.ethereum : providerMapRef.current.get(providerUuid);
    if (!provider) {
      setError("Wallet not found — it may have been uninstalled or disabled since this list was built.");
      return null;
    }
    setConnecting(true);
    setError(null);
    try {
      const client = createWalletClient({ transport: custom(provider) });
      const [account] = await withTimeout(
        client.requestAddresses(),
        EVM_CONNECT_TIMEOUT_MS,
        "Wallet didn't respond. Check for an approval popup that may have opened behind your browser window, or that your browser isn't blocking extension popups, then try again.",
      );
      activeProviderRef.current = provider;
      setAddress(account);
      setConnectedProviderUuid(providerUuid);
      // Real user report 2026-08-06: connecting from the swap page (already
      // set to sell from e.g. Arbitrum) still landed the wallet on whatever
      // chain it happened to be on already (usually Ethereum mainnet) — the
      // wallet has no way to know which chain THIS app actually wants
      // without being told. `switchChain` is idempotent (a wallet already
      // on the target chain just resolves immediately, no prompt) so it's
      // safe to always attempt when the caller knows the intended chain.
      // Best-effort: a user declining the switch (or a wallet that doesn't
      // have that chain configured yet) shouldn't undo an otherwise-successful
      // connection — ensureChain() gets called again anyway right before any
      // real transaction, which is the actually-authoritative check.
      if (desiredChainId != null) {
        await client.switchChain({ id: desiredChainId }).catch(() => {});
      }
      return account;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    activeProviderRef.current = null;
    setAddress(null);
    setConnectedProviderUuid(null);
    setError(null);
  }, []);

  const ensureChain = useCallback(async (chainId: number) => {
    if (!activeProviderRef.current) throw new Error("No EVM wallet connected");
    const client = createWalletClient({ transport: custom(activeProviderRef.current) });
    await client.switchChain({ id: chainId });
  }, []);

  const sendStepAndWait = useCallback(async (step: RelayEvmStep): Promise<string> => {
    if (!activeProviderRef.current) throw new Error("No EVM wallet connected");
    const walletClient = createWalletClient({ transport: custom(activeProviderRef.current) });
    const publicClient = createPublicClient({ transport: custom(activeProviderRef.current) });

    const hash = await walletClient.sendTransaction({
      account: step.from as Hex,
      to: step.to as Hex,
      data: step.data as Hex,
      value: step.value ? BigInt(step.value) : undefined,
      chain: null,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }, []);

  // personal_sign, not a transaction — used only by the SIWE link flow
  // (see lib/auth/siwe.ts) to prove ownership of the connected address.
  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!activeProviderRef.current) throw new Error("No EVM wallet connected");
    const client = createWalletClient({ transport: custom(activeProviderRef.current) });
    const [account] = await client.getAddresses();
    if (!account) throw new Error("No EVM account connected");
    return client.signMessage({ account, message });
  }, []);

  const value = useMemo(
    () => ({
      providers,
      address,
      connectedProviderUuid,
      connecting,
      error,
      connect,
      disconnect,
      ensureChain,
      sendStepAndWait,
      signMessage,
    }),
    [providers, address, connectedProviderUuid, connecting, error, connect, disconnect, ensureChain, sendStepAndWait, signMessage],
  );

  return <EvmWalletContext.Provider value={value}>{children}</EvmWalletContext.Provider>;
}

export function useEvmWallet(): EvmWalletContextValue {
  const ctx = useContext(EvmWalletContext);
  if (!ctx) throw new Error("useEvmWallet must be used within an EvmWalletProvider");
  return ctx;
}
