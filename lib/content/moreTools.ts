// Single source of truth for the "power tool" surfaces (Dust Sweeper,
// Baskets, ClickPay, Trigger Orders, Games) — shared between the homepage's
// "More tools" section (app/page.tsx) and Footer.tsx (2026-08-11 site-wide
// pass) so the two never drift into listing different sets, same "one
// source, two outputs" pattern lib/content/faq.ts already uses.
export interface MoreToolLink {
  icon: string;
  label: string;
  href: string;
}

export const MORE_TOOLS: MoreToolLink[] = [
  { icon: "🧹", label: "Dust Sweeper", href: "/dust-sweeper" },
  { icon: "🧺", label: "Portfolio Baskets", href: "/basket" },
  { icon: "⚡", label: "ClickPay", href: "/pay/create" },
  { icon: "⏱️", label: "Trigger Orders", href: "/orders" },
  { icon: "🎮", label: "Community Games", href: "/games" },
];
