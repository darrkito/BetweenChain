"use client";

import { useState } from "react";
import { AppHeader } from "@/app/components/AppHeader";
import { SWAP_CHAINS } from "@/lib/chains/swapChains";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";

interface AddressSecurity {
  isMalicious: boolean;
  reasons: string[];
}

interface TokenSecurity {
  isHoneypot: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  ownerCanChangeBalance: boolean;
  isProxy: boolean;
  isMintable: boolean;
}

const EVM_CHAINS = SWAP_CHAINS.filter((c) => c.chainId !== SOLANA_CHAIN_ID_CLIENT);

// Burner Shield Lite (2026-08-09) — a real pre-sign safety check backed by
// GoPlus Security's free, no-key API (lib/goplus/security.ts), scoped down
// from the original pitch's full ERC-4337 isolated-execution engine — see
// PLAN_SAFETY_DISCOVERY_FEATURES.md for why (that needs new
// account-abstraction infra plus a real decision about funding gas for
// arbitrary unvetted contracts, a materially bigger risk than this app has
// taken on so far). EVM-only — GoPlus's address/token security data is
// EVM-chain-scoped.
export function BurnerShieldClient() {
  const [chainId, setChainId] = useState<number>(EVM_CHAINS[0]?.chainId ?? 1);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [addressSecurity, setAddressSecurity] = useState<AddressSecurity | null>(null);
  const [tokenSecurity, setTokenSecurity] = useState<TokenSecurity | null>(null);
  const [checked, setChecked] = useState(false);

  async function check() {
    setLoading(true);
    setMessage(null);
    setChecked(false);
    try {
      const res = await fetch(`/api/burner-shield/check?address=${address}&chainId=${chainId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Check failed");
      setAddressSecurity(body.addressSecurity);
      setTokenSecurity(body.tokenSecurity);
      setChecked(true);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const flaggedToken =
    tokenSecurity && (tokenSecurity.isHoneypot || tokenSecurity.ownerCanChangeBalance || (tokenSecurity.buyTaxPct ?? 0) > 10 || (tokenSecurity.sellTaxPct ?? 0) > 10);
  const anyRisk = addressSecurity?.isMalicious || flaggedToken;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1 px-1">
          <h1 className="font-display text-2xl font-normal text-ink">🛡️ Burner Shield</h1>
          <p className="text-sm text-ink-muted">
            Check a contract or token address for known risk flags before you sign anything — new dApp, unfamiliar token,
            an approval request you&apos;re unsure about.
          </p>
        </div>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {EVM_CHAINS.map((c) => (
              <button
                key={c.chainId}
                onClick={() => setChainId(c.chainId)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  chainId === c.chainId ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <input
            className="num rounded-lg border border-hairline bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            placeholder="Contract or token address (0x…)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button
            onClick={check}
            disabled={loading || !address}
            className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Checking…" : "Check for risk flags"}
          </button>
        </section>

        {checked && (
          <section
            className={`flex flex-col gap-3 rounded-2xl border p-5 shadow-sm ${
              anyRisk ? "border-danger bg-danger-soft" : "border-hairline bg-surface"
            }`}
          >
            <p className={`text-sm font-semibold ${anyRisk ? "text-danger" : "text-accent"}`}>
              {anyRisk ? "⚠️ Risk flags found — proceed with caution" : "✅ No known risk flags"}
            </p>

            {addressSecurity && addressSecurity.reasons.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-ink">
                {addressSecurity.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}

            {tokenSecurity && (
              <div className="flex flex-col gap-1 text-sm text-ink-muted">
                {tokenSecurity.isHoneypot && <p className="text-danger">This token is flagged as a honeypot — likely cannot be sold.</p>}
                {tokenSecurity.ownerCanChangeBalance && <p className="text-danger">The contract owner can directly change holder balances.</p>}
                {(tokenSecurity.buyTaxPct ?? 0) > 0 && <p>Buy tax: {tokenSecurity.buyTaxPct}%</p>}
                {(tokenSecurity.sellTaxPct ?? 0) > 0 && <p>Sell tax: {tokenSecurity.sellTaxPct}%</p>}
                {tokenSecurity.isMintable && <p>Supply is mintable by the owner.</p>}
              </div>
            )}

            <p className="text-[11px] text-ink-faint">
              Based on public data from GoPlus Security — a real, independent risk signal, not a guarantee. Always verify
              yourself before signing.
            </p>
          </section>
        )}

        {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
      </div>
    </main>
  );
}
