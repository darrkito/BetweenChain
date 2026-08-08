"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { request, getProviders, AddressPurpose, type Provider } from "sats-connect";

// sats-connect (Xverse's real wallet-connect library, ^4.2.1) — its OLDER
// `getAddress`/`sendBtcTransaction` callback-style functions are marked
// `@deprecated` in the package's own type declarations (confirmed by reading
// node_modules/sats-connect directly, not assumed from docs) in favor of a
// generic `request<Method>(method, params, providerId?)` RPC call that
// already returns a real Promise — used throughout below instead of the
// deprecated pair. `request("getAddresses", ...)` doubles as both the
// permission-grant AND the address fetch (same single-step shape the
// deprecated `getAddress` had), so no separate "connect" RPC call exists.
interface BtcWalletContextValue {
  providers: Provider[];
  address: string | null;
  connectedProviderId: string | null;
  connecting: boolean;
  error: string | null;
  connect: (providerId: string) => Promise<string | null>;
  disconnect: () => void;
  // amountBtc is decimal BTC (matching ChangeNOW's own decimal-amount API,
  // lib/chains/changenow.ts) — converted to satoshis here, sats-connect's
  // real `sendTransfer` request wants a plain integer, not a decimal.
  sendPayment: (toAddress: string, amountBtc: number) => Promise<string>;
}

const BtcWalletContext = createContext<BtcWalletContextValue | null>(null);

// Same class of bug as the Phantom (Solana) "stuck on Connecting…" fix
// found earlier this session — a Bitcoin wallet's own approval popup can
// just as easily open off-screen or never respond; this closes the same gap
// before it ever gets a chance to happen here.
const BTC_CONNECT_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

/**
 * Shared app-wide Bitcoin wallet state — same Context+hook shape as
 * EvmWalletProvider.tsx/SuiWalletProvider.tsx, so one "Connect Wallet" entry
 * point drives every consumer. Connect-only, deliberately no separate
 * sign-in/auth step — mirrors Sui's real pattern (confirmed in
 * SuiWalletProvider.tsx's own comments: "Sui has no SIWS/SIWE-equivalent of
 * its own... only used here to pay and receive"). Bitcoin is purely a
 * payment rail here too — account identity stays whatever the existing
 * Solana/Ethereum session already is.
 */
export function BtcWalletProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [connectedProviderId, setConnectedProviderId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    // Deferred to a microtask (same pattern as CollectionPageClient.tsx's
    // mount-skip guards / this session's other new providers) rather than a
    // synchronous setState call in the effect body — required by this
    // repo's react-hooks/set-state-in-effect lint rule, not just to silence
    // it.
    Promise.resolve().then(() => {
      if (!ignore) setProviders(getProviders());
    });
    return () => {
      ignore = true;
    };
  }, []);

  const connect = useCallback(async (providerId: string) => {
    setConnecting(true);
    setError(null);
    try {
      const result = await withTimeout(
        request(
          "getAddresses",
          { purposes: [AddressPurpose.Payment], message: "Connect to Blockchains.Click to pay with Bitcoin" },
          providerId,
        ),
        BTC_CONNECT_TIMEOUT_MS,
        "Wallet didn't respond. Check for an approval popup that may have opened behind your browser window, or that your browser isn't blocking extension popups, then try again.",
      );
      if (result.status === "error") {
        setError(result.error.message);
        return null;
      }
      const paymentAddress = result.result.addresses.find((a) => a.purpose === AddressPurpose.Payment)?.address;
      if (!paymentAddress) {
        setError("Wallet didn't return a payment address.");
        return null;
      }
      setAddress(paymentAddress);
      setConnectedProviderId(providerId);
      return paymentAddress;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setConnectedProviderId(null);
    setError(null);
  }, []);

  const sendPayment = useCallback(
    async (toAddress: string, amountBtc: number): Promise<string> => {
      if (!connectedProviderId) throw new Error("No Bitcoin wallet connected");
      const amountSats = Math.round(amountBtc * 1e8);
      const result = await request("sendTransfer", { recipients: [{ address: toAddress, amount: amountSats }] }, connectedProviderId);
      if (result.status === "error") throw new Error(result.error.message);
      return result.result.txid;
    },
    [connectedProviderId],
  );

  const value = useMemo(
    () => ({ providers, address, connectedProviderId, connecting, error, connect, disconnect, sendPayment }),
    [providers, address, connectedProviderId, connecting, error, connect, disconnect, sendPayment],
  );

  return <BtcWalletContext.Provider value={value}>{children}</BtcWalletContext.Provider>;
}

export function useBtcWallet(): BtcWalletContextValue {
  const ctx = useContext(BtcWalletContext);
  if (!ctx) throw new Error("useBtcWallet must be used within a BtcWalletProvider");
  return ctx;
}
