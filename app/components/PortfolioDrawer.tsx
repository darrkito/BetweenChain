"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { usePrefersReducedMotion } from "@/lib/client/usePrefersReducedMotion";
import { SWAP_CHAINS } from "@/lib/chains/swapChains";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";

interface Holding {
  symbol: string;
  balance: string;
  balanceUsd: string | null;
  isNative: boolean;
}

interface Section {
  chainLabel: string;
  holdings: Holding[];
}

const EVM_CHAINS_FOR_PORTFOLIO = SWAP_CHAINS.filter((c) => c.slug !== "solana");

async function fetchChainHoldings(chainId: number, owner: string): Promise<Holding[]> {
  const res = await fetch(`/api/tokens/balances?chainId=${chainId}&owner=${owner}`);
  if (!res.ok) return [];
  const body: { balances?: Holding[] } = await res.json();
  return body.balances ?? [];
}

// Slide-out portfolio drawer (2026-08-07) — same motion/AnimatePresence
// mechanics as the removed ActivityDrawer.tsx / the SwapProgressDrawer built
// earlier today, a new component for a different purpose. Solana + EVM (all
// 6 supported chains, fanned out via the existing /api/tokens/balances
// endpoint — same one TokenSelectModal's "Your tokens" already uses) +
// native-SUI-only (lib/chains/sui.ts has no multi-coin balance function —
// honestly labeled "Native SUI" here, not implied as a full Sui portfolio).
// Real balances only: a chain section is simply omitted if that wallet
// isn't connected, and balanceUsd stays null (shown as "—") rather than
// fabricated when no price source exists — same discipline
// /api/tokens/balances already has.
export function PortfolioDrawer() {
  const { publicKey } = useWallet();
  const evmWallet = useEvmWallet();
  const suiAccount = useCurrentAccount();
  const reducedMotion = usePrefersReducedMotion();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);

  const solanaAddress = publicKey?.toBase58() ?? null;
  const evmAddress = evmWallet.address;
  const suiAddress = suiAccount?.address ?? null;
  const anyWalletConnected = Boolean(solanaAddress || evmAddress || suiAddress);

  useEffect(() => {
    if (!open) return;
    let ignore = false;

    (async () => {
      setLoading(true);
      const nextSections: Section[] = [];

      if (solanaAddress) {
        const holdings = await fetchChainHoldings(SOLANA_CHAIN_ID_CLIENT, solanaAddress).catch(() => []);
        if (holdings.length > 0) nextSections.push({ chainLabel: "Solana", holdings });
      }

      if (evmAddress) {
        const results = await Promise.all(
          EVM_CHAINS_FOR_PORTFOLIO.map((chain) =>
            fetchChainHoldings(chain.chainId, evmAddress)
              .then((holdings) => ({ label: chain.label, holdings }))
              .catch(() => ({ label: chain.label, holdings: [] as Holding[] })),
          ),
        );
        for (const r of results) {
          if (r.holdings.length > 0) nextSections.push({ chainLabel: r.label, holdings: r.holdings });
        }
      }

      if (suiAddress) {
        const res = await fetch(`/api/tokens/sui-balance?owner=${suiAddress}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (res && Number(res.balance) > 0) {
          nextSections.push({
            chainLabel: "Sui (native only)",
            holdings: [{ symbol: "SUI", balance: res.balance, balanceUsd: res.balanceUsd, isNative: true }],
          });
        }
      }

      if (!ignore) {
        setSections(nextSections);
        setLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [open, solanaAddress, evmAddress, suiAddress]);

  const totalUsd = sections
    .flatMap((s) => s.holdings)
    .reduce((sum, h) => (h.balanceUsd ? sum + Number(h.balanceUsd) : sum), 0);
  const hasAnyUnknownPrice = sections.some((s) => s.holdings.some((h) => h.balanceUsd == null));

  if (!anyWalletConnected) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Portfolio"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted transition-all hover:border-accent/40 hover:text-accent active:scale-90"
      >
        <span aria-hidden="true">💼</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-hairline bg-surface p-5 shadow-xl"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-normal text-ink">Portfolio</h2>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink"
                >
                  ✕
                </button>
              </div>

              <div className="rounded-xl bg-surface-hover px-4 py-3">
                <p className="text-xs text-ink-faint">Total (Solana + EVM + native SUI)</p>
                <p className="num text-2xl font-semibold text-ink">
                  {loading ? "…" : `$${totalUsd.toFixed(2)}`}
                  {hasAnyUnknownPrice && !loading && <span className="ml-1 text-xs font-normal text-ink-faint">+ unpriced holdings</span>}
                </p>
              </div>

              {loading ? (
                <p className="text-sm text-ink-faint">Loading balances…</p>
              ) : sections.length === 0 ? (
                <p className="text-sm text-ink-faint">No known token balances found on the chains this app tracks.</p>
              ) : (
                sections.map((section) => (
                  <section key={section.chainLabel} className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{section.chainLabel}</p>
                    {section.holdings.map((h) => (
                      <div
                        key={h.symbol}
                        className="num flex items-center justify-between rounded-xl border border-hairline px-3 py-2 text-sm"
                      >
                        <span className="text-ink">
                          {h.balance} {h.symbol}
                        </span>
                        <span className="text-ink-faint">{h.balanceUsd ? `$${h.balanceUsd}` : "—"}</span>
                      </div>
                    ))}
                  </section>
                ))
              )}

              <p className="text-[11px] leading-relaxed text-ink-faint">
                Only shows tokens this app already knows about on each chain, plus native SUI — not a full arbitrary
                wallet scan.
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
