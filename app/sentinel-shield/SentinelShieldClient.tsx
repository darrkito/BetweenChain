"use client";

import { useCallback, useEffect, useState } from "react";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { swapChainForChainId } from "@/lib/chains/swapChains";

interface Snapshot {
  chainId: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  healthFactor: number | null;
}

// Sentinel Shield (2026-08-09, read-only v1) — Aave health-factor
// monitoring across Ethereum/Arbitrum/Base. Deliberately does NOT
// auto-repay or move funds — see PLAN_SAFETY_DISCOVERY_FEATURES.md's
// reasoning: automated fund movement here is the highest-consequence
// automation in the whole feature batch and needs its own dedicated
// review before any code touches real collateral unattended. This ships
// the real, useful, appropriately-scoped first step: know your risk.
function statusFor(hf: number | null): { label: string; color: string } {
  if (hf === null) return { label: "No open borrows", color: "text-ink-faint" };
  if (hf < 1.05) return { label: "Critical", color: "text-danger" };
  if (hf < 1.3) return { label: "At risk", color: "text-amber-500" };
  return { label: "Healthy", color: "text-accent" };
}

export function SentinelShieldClient() {
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!evmWallet.address) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/sentinel-shield/health?address=${evmWallet.address}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Check failed");
      setSnapshots(body.snapshots);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [evmWallet.address]);

  useEffect(() => {
    // Deferred via queueMicrotask — check() sets state before its first
    // await, which the set-state-in-effect rule correctly flags as a
    // same-tick cascading render when called directly from the effect body
    // (same fix as app/orders/OrdersClient.tsx's loadOrders effect).
    if (evmWallet.address) queueMicrotask(check);
  }, [evmWallet.address, check]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1 px-1">
          <h1 className="font-display text-2xl font-normal text-ink">🛡️ Sentinel Shield</h1>
          <p className="text-sm text-ink-muted">
            Live Aave health-factor monitoring across Ethereum, Arbitrum, and Base. Read-only — this never moves funds or
            repays anything automatically.
          </p>
        </div>

        {!evmWallet.address ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
            <p className="text-sm text-ink-muted">Connect an EVM wallet to check your borrow positions.</p>
            <button
              onClick={() => connectWalletModal.setOpen(true)}
              className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Connect wallet
            </button>
          </section>
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-ink-faint">Checking {evmWallet.address}</span>
              <button onClick={check} disabled={loading} className="text-xs font-medium text-accent hover:underline disabled:opacity-40">
                {loading ? "Checking…" : "Refresh"}
              </button>
            </div>

            {snapshots
              .filter((s) => s.totalCollateralUsd > 0 || s.totalDebtUsd > 0)
              .map((s) => {
                const chain = swapChainForChainId(s.chainId);
                const status = statusFor(s.healthFactor);
                return (
                  <section key={s.chainId} className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-ink">Aave · {chain?.label ?? `Chain ${s.chainId}`}</span>
                      <span className={`text-sm font-semibold ${status.color}`}>{status.label}</span>
                    </div>
                    <div className="flex justify-between text-sm text-ink-muted">
                      <span>Health factor</span>
                      <span className="num text-ink">{s.healthFactor === null ? "—" : s.healthFactor.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-ink-muted">
                      <span>Collateral</span>
                      <span className="num text-ink">${s.totalCollateralUsd.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-ink-muted">
                      <span>Debt</span>
                      <span className="num text-ink">${s.totalDebtUsd.toFixed(2)}</span>
                    </div>
                  </section>
                );
              })}

            {!loading && snapshots.every((s) => s.totalCollateralUsd === 0 && s.totalDebtUsd === 0) && (
              <p className="text-sm text-ink-faint">No open Aave positions found on Ethereum, Arbitrum, or Base for this wallet.</p>
            )}
          </>
        )}

        {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
      </div>
    </main>
  );
}
