"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/lib/client/ThemeToggle";
import { SocialXLink } from "@/app/components/SocialXLink";

// ConnectWalletMenu reads live browser wallet state, so it must never be
// part of SSR — same reasoning the old WalletMultiButton import here had.
const ConnectWalletMenu = dynamic(
  () => import("@/app/components/ConnectWalletMenu").then((m) => m.ConnectWalletMenu),
  { ssr: false },
);

// Reads live wallet state (same reasoning as ConnectWalletMenu above) — must
// never be part of SSR. Renders nothing until a wallet is connected.
const PortfolioDrawer = dynamic(
  () => import("@/app/components/PortfolioDrawer").then((m) => m.PortfolioDrawer),
  { ssr: false },
);

// Reads the session (useAuth) and fetches a per-user balance client-side —
// same SSR exclusion reasoning as the two above, otherwise the server-
// rendered "signed out" state would hydration-mismatch against a real
// signed-in balance.
const PointsPill = dynamic(
  () => import("@/app/components/PointsPill").then((m) => m.PointsPill),
  { ssr: false },
);

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

// 2026-08-09 (header redesign) — the flat NAV array grew to 12 items across
// this session's feature pushes (Swap, NFTs, Radar, Games, Dust Sweeper,
// Baskets, ClickPay, Trigger Orders, Evac Engine, Sentinel Shield, Burner
// Shield, Rewards) and stopped fitting either desktop (12 pill buttons
// wrapped into a messy second row) or mobile (shortLabels alone couldn't
// save it — real user report, both surfaces). Regrouped into 4 labeled
// dropdown categories + Rewards standalone, same "which real problem does
// this feature solve" groupings used in PLAN_SAFETY_DISCOVERY_FEATURES.md:
// trading, portfolio hygiene, wallet safety, and discovery are genuinely
// different jobs a visitor comes here to do.
const NAV_GROUPS: Array<{ label: string; icon: string; items: NavItem[] }> = [
  {
    label: "Trade",
    icon: "⇄",
    items: [
      { href: "/swap", label: "Token Swap", icon: "⇄" },
      { href: "/pay/create", label: "ClickPay", icon: "⚡" },
      { href: "/orders", label: "Trigger Orders", icon: "⏱️" },
    ],
  },
  {
    label: "Portfolio",
    icon: "🧺",
    items: [
      { href: "/dust-sweeper", label: "Dust Sweeper", icon: "🧹" },
      { href: "/basket", label: "Portfolio Baskets", icon: "🧺" },
      { href: "/rebalance", label: "Rebalancer", icon: "⚖️" },
      { href: "/evac", label: "Evac Engine", icon: "🚨" },
    ],
  },
  {
    label: "Safety",
    icon: "🛡️",
    items: [
      { href: "/sentinel-shield", label: "Sentinel Shield", icon: "🛡️" },
      { href: "/burner-shield", label: "Burner Shield", icon: "🛡️" },
    ],
  },
  {
    label: "Discover",
    icon: "🧭",
    items: [
      { href: "/nft", label: "NFTs", icon: "🖼️" },
      { href: "/radar", label: "Meme Radar", icon: "📡" },
      { href: "/games", label: "Games", icon: "🎮" },
    ],
  },
];

const STANDALONE: NavItem = { href: "/dashboard", label: "Rewards", icon: "🏆" };

function groupIsActive(group: { items: NavItem[] }, pathname: string) {
  return group.items.some((i) => pathname.startsWith(i.href));
}

/** Desktop-only dropdown for one nav group — a button that opens a small anchored panel, closes on outside click, Escape, or navigation. */
function NavGroupDropdown({ group, pathname }: { group: (typeof NAV_GROUPS)[number]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = groupIsActive(group, pathname);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Closes automatically when the route actually changes (a link inside was
  // clicked) — cheaper than wiring an onClick through every Link below.
  // Deferred via queueMicrotask, same fix as OrdersClient/SentinelShieldClient's
  // effects — calling setState directly in the effect body is flagged by
  // react-hooks/set-state-in-effect as a same-tick cascading render.
  useEffect(() => {
    queueMicrotask(() => setOpen(false));
  }, [pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
          active ? "bg-accent text-accent-ink" : "text-ink-muted hover:bg-accent-soft hover:text-ink"
        }`}
      >
        {group.label}
        <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-xl border border-hairline bg-surface p-1.5 shadow-lg">
          {group.items.map((item) => {
            const itemActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  itemActive ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-hover"
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Mobile nav overlay content — every group as a labeled section, full-width.
 * Controlled (open/setOpen passed in) so both the bottom command bar's
 * "More" tab and any future trigger can open the same overlay instead of
 * each maintaining a separate copy of this markup.
 */
function MobileNavOverlay({ pathname, open, setOpen }: { pathname: string; open: boolean; setOpen: (v: boolean) => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true));
  }, []);

  useEffect(() => {
    queueMicrotask(() => setOpen(false));
  }, [pathname, setOpen]);

  if (!mounted || !open) return null;

  // Portaled to document.body — this component renders inside AppHeader's
  // <header>, which has `backdrop-blur`. Any ancestor backdrop-filter/
  // filter/transform creates its own containing block for `position: fixed`
  // descendants, so without the portal this overlay would render confined to
  // the header's own bounds instead of the full viewport — the exact bug
  // already found and fixed this way in ConnectWalletMenu.tsx (2026-07-21)
  // and PortfolioDrawer.tsx (2026-08-07).
  return createPortal(
    (
        <div className="fixed inset-0 z-30 flex flex-col bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="mt-2 flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-2xl border border-hairline bg-surface p-4 shadow-xl"
            style={{ marginInline: "0.75rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="text-ink-faint hover:text-ink">
                ✕
              </button>
            </div>
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{group.label}</p>
                {group.items.map((item) => {
                  const itemActive = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        itemActive ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-hover"
                      }`}
                    >
                      <span aria-hidden="true">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
            <div className="flex flex-col gap-1 border-t border-hairline pt-3">
              <Link
                href={STANDALONE.href}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  pathname.startsWith(STANDALONE.href) ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-hover"
                }`}
              >
                <span aria-hidden="true">{STANDALONE.icon}</span>
                {STANDALONE.label}
              </Link>
            </div>
          </div>
        </div>
    ),
    document.body,
  );
}

const BOTTOM_BAR_TABS: Array<NavItem> = [
  { href: "/swap", label: "Swap", icon: "⇄" },
  { href: "/orders", label: "Activity", icon: "⏱️" },
  { href: STANDALONE.href, label: STANDALONE.label, icon: STANDALONE.icon },
];

/**
 * Persistent bottom command bar, mobile only (2026-08-10 — see PLAN.md's
 * "Rebrand / SEO / mobile-UX" assessment: this was the one genuinely-new,
 * no-custody UI gap identified there). Replaces the old top-right hamburger
 * as the primary mobile nav entry point — "More" opens the exact same
 * `MobileNavOverlay` grouped menu the hamburger used to, just triggered from
 * here instead, so nothing about the overlay itself needed to change.
 * `env(safe-area-inset-bottom)` accounts for the home-indicator area on
 * notched phones; `globals.css` adds matching `body` padding below `sm` so
 * page content never sits underneath this bar.
 */
function MobileBottomBar({ pathname, moreOpen, setMoreOpen }: { pathname: string; moreOpen: boolean; setMoreOpen: (v: boolean) => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true));
  }, []);

  if (!mounted) return null;

  // Portaled to document.body for the same reason as MobileNavOverlay above
  // — this component is rendered inside AppHeader's `backdrop-blur` header,
  // which would confine `position: fixed` to the header's own bounds
  // instead of pinning to the viewport bottom.
  return createPortal(
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-hairline bg-surface/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {BOTTOM_BAR_TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
              active ? "text-accent" : "text-ink-muted"
            }`}
          >
            <span aria-hidden="true" className="text-base leading-none">
              {tab.icon}
            </span>
            {tab.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => setMoreOpen(!moreOpen)}
        aria-expanded={moreOpen}
        aria-label="More"
        className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
          moreOpen ? "text-accent" : "text-ink-muted"
        }`}
      >
        <span aria-hidden="true" className="text-base leading-none">
          ☰
        </span>
        More
      </button>
    </nav>,
    document.body,
  );
}

/**
 * Shared top bar for every page — brand + primary nav + wallet connect.
 * `ConnectWalletMenu` (2026-07-21, replaces the old Solana-only
 * `WalletMultiButton`) is chain-grouped (Solana/Ethereum/Sui) — both Solana
 * and EVM wallet state are now real shared contexts (`app/providers.tsx`'s
 * `WalletProvider` and `EvmWalletProvider`), so connecting here carries
 * through to the swap page and NFT buy modal without reconnecting.
 */
export function AppHeader() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    // Real layout bug found live 2026-08-03: nav/wordmark text had no
    // `whitespace-nowrap`, so on a squeezed width the text itself would wrap
    // onto a second line INSIDE a single-line flex row. Fixed by keeping the
    // whole bar to a small, fixed set of top-level controls now (see
    // NAV_GROUPS' doc comment above for why the old 12-item flat list was
    // the real root cause of the header feeling crowded/broken on both
    // desktop and mobile, not just a missing CSS property).
    <header className="flex items-center justify-between gap-2 rounded-2xl border border-hairline bg-surface/90 p-2.5 pl-3 shadow-sm backdrop-blur">
      <div className="flex min-w-0 items-center gap-2 sm:gap-5">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {/* Rebrand 2026-08-04 (ChainBreak → Blockchains.Click, new
              blockchains.click domain). New icon concept: three small chain
              nodes converging into one point — "all the blockchains, in one
              click" — replaces the old crossing-arrows "break/swap" motif,
              which read as this app's prior swap-focused identity rather
              than the broader multi-chain-in-one-click positioning. Same
              accent purple (`var(--accent)`) kept for continuity with the
              rest of the design system (see STATE.md 2026-07-20g). */}
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="shrink-0">
            <circle cx="6" cy="6" r="2.4" fill="var(--ink-faint)" />
            <circle cx="20" cy="6" r="2.4" fill="var(--ink-faint)" />
            <circle cx="6" cy="20" r="2.4" fill="var(--ink-faint)" />
            <path
              d="M6 6 13 13M20 6 13 13M6 20 13 13"
              stroke="var(--ink-faint)"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.6"
            />
            <circle cx="13" cy="13" r="4.2" fill="var(--accent)" />
          </svg>
          {/* Full wordmark + tagline on wider screens; below `sm` (real risk:
              logo + nav + "Wallets connected" all crowding a ~360px viewport
              at once) it shrinks to just the initials so the nav links and
              wallet button always have room. `whitespace-nowrap` on both —
              see the header-level comment above for the real bug this
              closes (text wrapping mid-word inside a squeezed flex item). */}
          <span className="hidden flex-col sm:flex">
            <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-ink">
              Blockchains<span className="text-accent">.Click</span>
            </span>
            <span className="hidden whitespace-nowrap text-[11px] font-medium leading-tight text-ink-faint lg:block">
              0.25% per leg, zero manual bridging
            </span>
          </span>
          <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-ink sm:hidden">
            B<span className="text-accent">C</span>
          </span>
        </Link>
        {/* Desktop nav: 4 grouped dropdowns + Rewards standalone, hidden
            below `sm` in favor of MobileNav's hamburger overlay. */}
        <nav className="hidden shrink-0 items-center gap-1 sm:flex">
          {NAV_GROUPS.map((group) => (
            <NavGroupDropdown key={group.label} group={group} pathname={pathname} />
          ))}
          <Link
            href={STANDALONE.href}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              pathname.startsWith(STANDALONE.href) ? "bg-accent text-accent-ink" : "text-ink-muted hover:bg-accent-soft hover:text-ink"
            }`}
          >
            {STANDALONE.label}
          </Link>
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SocialXLink className="hidden h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted transition-all hover:border-accent/40 hover:text-accent sm:flex" />
        <ThemeToggle />
        <PointsPill />
        <PortfolioDrawer />
        <ConnectWalletMenu />
      </div>
      <MobileNavOverlay pathname={pathname} open={moreOpen} setOpen={setMoreOpen} />
      <MobileBottomBar pathname={pathname} moreOpen={moreOpen} setMoreOpen={setMoreOpen} />
    </header>
  );
}
