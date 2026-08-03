"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";

interface AuthContextValue {
  // The pubkey the backend session actually belongs to — null until the
  // initial /api/auth/session check resolves, so callers can distinguish
  // "not signed in" from "haven't checked yet" (checked below).
  sessionPubkey: string | null;
  // The EVM address verified onto the current session, if any — either
  // linked onto an existing Solana session (migration 0007_evm_link.sql) or
  // the sole identity of a standalone EVM-only session (migration
  // 0008_evm_standalone_signin.sql, no Solana wallet required at all).
  evmVerifiedAddress: string | null;
  checked: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<boolean>;
  signingInEvm: boolean;
  evmError: string | null;
  signInEvm: (evmAddress: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Shared SIWS auth state — promoted from a page-local hook (`useAuth`, only
 * ever used on the swap page) to a context on 2026-07-21, so the header's
 * Connect Wallet popup can offer "Sign in with Solana" as part of the same
 * flow instead of it being a separate, easy-to-miss button buried on the
 * swap page only. Deliberately does NOT auto-trigger `signMessage()`
 * immediately after `connect()` resolves — chaining a second wallet prompt
 * without a fresh user click risks the same "extension needs a real user
 * gesture" failure mode that broke Phantom's connect() when it was wired
 * through an autoConnect-style effect (see app/providers.tsx's autoConnect
 * removal). Sign-in stays its own explicit click, shown right under the
 * connected address whenever `sessionPubkey !== publicKey`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage } = useWallet();
  const evm = useEvmWallet();
  const [sessionPubkey, setSessionPubkey] = useState<string | null>(null);
  const [evmVerifiedAddress, setEvmVerifiedAddress] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingInEvm, setSigningInEvm] = useState(false);
  const [evmError, setEvmError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((body: { solanaPubkey: string | null; evmVerifiedAddress: string | null }) => {
        if (!ignore) {
          setSessionPubkey(body.solanaPubkey);
          setEvmVerifiedAddress(body.evmVerifiedAddress);
        }
      })
      .catch(() => {
        if (!ignore) {
          setSessionPubkey(null);
          setEvmVerifiedAddress(null);
        }
      })
      .finally(() => {
        if (!ignore) setChecked(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError("Connect a wallet that supports message signing (Phantom, Solflare)");
      return false;
    }
    setSigningIn(true);
    setError(null);
    try {
      const solanaPubkey = publicKey.toBase58();

      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solanaPubkey }),
      });
      if (!challengeRes.ok) throw new Error((await challengeRes.json()).error ?? "Challenge request failed");
      const { nonce, message } = await challengeRes.json();

      const signature = await signMessage(new TextEncoder().encode(message));

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solanaPubkey, nonce, signature: bs58.encode(signature) }),
      });
      if (!verifyRes.ok) throw new Error((await verifyRes.json()).error ?? "Verification failed");

      setSessionPubkey(solanaPubkey);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage]);

  // Works standalone (no Solana session needed — mints a brand new EVM-
  // anchored session, migration 0008_evm_standalone_signin.sql) or in link
  // mode when a Solana session already exists (migration
  // 0007_evm_link.sql) — the backend decides which based on whether a
  // session cookie is present; this just re-checks the full session
  // afterward so client state reflects whichever branch actually ran.
  const signInEvm = useCallback(
    async (evmAddress: string) => {
      setSigningInEvm(true);
      setEvmError(null);
      try {
        const challengeRes = await fetch("/api/auth/evm/challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evmAddress }),
        });
        if (!challengeRes.ok) throw new Error((await challengeRes.json()).error ?? "Challenge request failed");
        const { nonce, message } = await challengeRes.json();

        const signature = await evm.signMessage(message);

        const verifyRes = await fetch("/api/auth/evm/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evmAddress, nonce, signature }),
        });
        if (!verifyRes.ok) throw new Error((await verifyRes.json()).error ?? "Verification failed");

        const sessRes = await fetch("/api/auth/session");
        const sessBody: { solanaPubkey: string | null; evmVerifiedAddress: string | null } = await sessRes.json();
        setSessionPubkey(sessBody.solanaPubkey);
        setEvmVerifiedAddress(sessBody.evmVerifiedAddress);
        return true;
      } catch (err) {
        setEvmError((err as Error).message);
        return false;
      } finally {
        setSigningInEvm(false);
      }
    },
    [evm],
  );

  const value = useMemo(
    () => ({ sessionPubkey, evmVerifiedAddress, checked, signingIn, error, signIn, signingInEvm, evmError, signInEvm }),
    [sessionPubkey, evmVerifiedAddress, checked, signingIn, error, signIn, signingInEvm, evmError, signInEvm],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
