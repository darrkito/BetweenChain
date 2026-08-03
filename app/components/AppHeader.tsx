"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/lib/client/ThemeToggle";

// ConnectWalletMenu reads live browser wallet state, so it must never be
// part of SSR — same reasoning the old WalletMultiButton import here had.
const ConnectWalletMenu = dynamic(
  () => import("@/app/components/ConnectWalletMenu").then((m) => m.ConnectWalletMenu),
  { ssr: false },
);

const NAV = [
  { href: "/", label: "Token Swap" },
  { href: "/nft", label: "NFTs" },
];

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

  return (
    <header className="flex items-center justify-between gap-2 rounded-2xl border border-hairline bg-surface/90 p-2.5 pl-3 shadow-sm backdrop-blur sm:gap-3">
      <div className="flex min-w-0 items-center gap-2 sm:gap-5">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="shrink-0">
            <path
              d="M6 10.5 10.5 6M6 10.5h13M6 10.5l4.5 4.5"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M20 15.5 15.5 20M20 15.5H7M20 15.5l-4.5-4.5"
              stroke="var(--ink-faint)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {/* Full wordmark on wider screens; below `sm` (real risk: logo +
              nav + "Wallets connected" all crowding a ~360px viewport at
              once) it shrinks to just the initials so the nav links and
              wallet button always have room. */}
          <span className="hidden text-[15px] font-semibold tracking-tight text-ink sm:inline">
            Swapper<span className="text-accent">Between</span>Chains
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink sm:hidden">
            S<span className="text-accent">B</span>C
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3.5 ${
                  active ? "bg-accent text-accent-ink" : "text-ink-muted hover:bg-accent-soft hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <ConnectWalletMenu />
      </div>
    </header>
  );
}
