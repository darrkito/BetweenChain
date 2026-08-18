"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSuiWallet } from "@/lib/client/SuiWalletProvider";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { usePrefersReducedMotion } from "@/lib/client/usePrefersReducedMotion";
import { TokenIcon } from "@/app/components/TokenIcon";
import { SWAP_CHAINS, SOLANA_SWAP_CHAIN } from "@/lib/chains/swapChains";
import { SUI_ICON_URL } from "@/lib/nft/labels";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";

interface Holding {
  symbol: string;
  logoURI: string;
  balance: string;
  balanceUsd: string | null;
  isNative: boolean;
}

interface Section {
  chainLabel: string;
  chainIconUrl: string | null;
  holdings: Holding[];
}

const EVM_CHAINS_FOR_PORTFOLIO = SWAP_CHAINS.filter((c) => c.slug !== "solana");

async function fetchChainHoldings(chainId: number, owner: string): Promise<Holding[]> {
  const res = await fetch(`/api/tokens/balances?chainId=${chainId}&owner=${owner}`);
  if (!res.ok) return [];
  const body: { balances?: Holding[] } = await res.json();
  return body.balances ?? [];
}

function sectionSubtotal(section: Section): number {
  return section.holdings.reduce((sum, h) => (h.balanceUsd ? sum + Number(h.balanceUsd) : sum), 0);
}

// Slide-out portfolio drawer (2026-08-07, visual pass same day) — same
// motion/AnimatePresence mechanics as the removed ActivityDrawer.tsx / the
// SwapProgressDrawer built earlier today. Solana + EVM (all 6 supported
// chains, fanned out via the existing /api/tokens/balances endpoint — same
// one TokenSelectModal's "Your tokens" already uses) + native-SUI-only
// (lib/chains/sui.ts has no multi-coin balance function — honestly labeled
// "Sui (native only)" here, not implied as a full Sui portfolio). Real
// balances only: a chain section is simply omitted if that wallet isn't
// connected, and balanceUsd stays null (shown as "—") rather than
// fabricated when no price source exists — same discipline
// /api/tokens/balances already has.
//
// Rendered via a portal straight to `document.body` — real bug found live
// 2026-08-07 (user report: "the portfolio icon... when you click its just a
// small window"): this used to render its `fixed` overlay/drawer directly
// inside AppHeader's own DOM position, and AppHeader's `<header>` has
// `backdrop-blur` on it — a `backdrop-filter` on any ancestor establishes
// its own containing block for `position: fixed` descendants, so the
// "full-viewport" drawer was actually being sized/positioned relative to
// the slim header bar instead of the viewport, rendering as a tiny box.
// Exact same root cause ConnectWalletMenu.tsx already documented and fixed
// with a portal (see its own comment) — this component just hadn't gotten
// the same fix yet.
export function PortfolioDrawer() {
  const { publicKey } = useWallet();
  const evmWallet = useEvmWallet();
  const sui = useSuiWallet();
  const reducedMotion = usePrefersReducedMotion();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true));
  }, []);

  const solanaAddress = publicKey?.toBase58() ?? null;
  const evmAddress = evmWallet.address;
  const suiAddress = sui.address;
  const anyWalletConnected = Boolean(solanaAddress || evmAddress || suiAddress);

  useEffect(() => {
    if (!open) return;
    let ignore = false;

    (async () => {
      setLoading(true);
      const nextSections: Section[] = [];

      if (solanaAddress) {
        const holdings = await fetchChainHoldings(SOLANA_CHAIN_ID_CLIENT, solanaAddress).catch(() => []);
        if (holdings.length > 0) nextSections.push({ chainLabel: "Solana", chainIconUrl: SOLANA_SWAP_CHAIN.iconUrl, holdings });
      }

      if (evmAddress) {
        const results = await Promise.all(
          EVM_CHAINS_FOR_PORTFOLIO.map((chain) =>
            fetchChainHoldings(chain.chainId, evmAddress)
              .then((holdings) => ({ label: chain.label, iconUrl: chain.iconUrl, holdings }))
              .catch(() => ({ label: chain.label, iconUrl: chain.iconUrl, holdings: [] as Holding[] })),
          ),
        );
        for (const r of results) {
          if (r.holdings.length > 0) nextSections.push({ chainLabel: r.label, chainIconUrl: r.iconUrl, holdings: r.holdings });
        }
      }

      if (suiAddress) {
        const res = await fetch(`/api/tokens/sui-balance?owner=${suiAddress}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (res && Number(res.balance) > 0) {
          nextSections.push({
            chainLabel: "Sui (native only)",
            chainIconUrl: SUI_ICON_URL,
            holdings: [{ symbol: "SUI", logoURI: SUI_ICON_URL, balance: res.balance, balanceUsd: res.balanceUsd, isNative: true }],
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

  const drawer = open ? (
    <AnimatePresence>
      <motion.div
        key="portfolio-backdrop"
        className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.2 }}
        onClick={() => setOpen(false)}
      />
      <motion.div
        key="portfolio-panel"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col overflow-y-auto border-l border-hairline bg-surface shadow-2xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.28, ease: "easeOut" }}
      >
        <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-hairline bg-surface/95 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-normal text-ink">Portfolio</h2>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
            >
              ✕
            </button>
          </div>

          {/* Big total-value header, same "one hero number" pattern Jupiter's
              and Relay's own portfolio panels use — everything else below is
              secondary detail. */}
          <div>
            <p className="text-xs text-ink-faint">Total balance</p>
            <p className="num text-3xl font-semibold tracking-tight text-ink">
              {loading ? "…" : `$${totalUsd.toFixed(2)}`}
            </p>
            {hasAnyUnknownPrice && !loading && (
              <p className="mt-0.5 text-[11px] text-ink-faint">+ holdings without a known USD price</p>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 p-5">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-14 w-full rounded-2xl" />
              ))}
            </div>
          ) : sections.length === 0 ? (
            <p className="text-sm text-ink-faint">No known token balances found on the chains this app tracks.</p>
          ) : (
            sections.map((section) => (
              <section key={section.chainLabel} className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-2">
                    {section.chainIconUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- small chain-CDN icon, same as elsewhere in this app
                      <img src={section.chainIconUrl} alt="" className="h-4 w-4 rounded-full" />
                    )}
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{section.chainLabel}</p>
                  </div>
                  <p className="num text-xs text-ink-faint">${sectionSubtotal(section).toFixed(2)}</p>
                </div>
                <div className="flex flex-col gap-1.5 rounded-2xl border border-hairline bg-surface p-1.5 shadow-sm">
                  {section.holdings.map((h) => (
                    <div key={h.symbol} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                      <TokenIcon logoURI={h.logoURI} symbol={h.symbol} size={30} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="num truncate text-sm font-medium text-ink">{h.balance}</span>
                        <span className="text-xs text-ink-faint">{h.symbol}</span>
                      </div>
                      <span className="num shrink-0 text-sm text-ink-muted">{h.balanceUsd ? `$${h.balanceUsd}` : "—"}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}

          {sections.length > 0 && (
            <Link
              href="/dust-sweeper"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-center text-xs font-semibold text-accent transition-colors hover:border-accent/40"
            >
              🧹 Got small stranded balances? Sweep dust →
            </Link>
          )}

          <p className="mt-auto px-0.5 text-[11px] leading-relaxed text-ink-faint">
            Only shows tokens this app already knows about on each chain, plus native SUI — not a full arbitrary
            wallet scan.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  ) : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Portfolio"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted transition-all hover:border-accent/40 hover:text-accent active:scale-90"
      >
        <span aria-hidden="true">💼</span>
      </button>

      {mounted && drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
