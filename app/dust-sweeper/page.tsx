import type { Metadata } from "next";
import { DustSweeperClient } from "./DustSweeperClient";

// Thin Server Component wrapper purely for real metadata — same split as
// app/radar/page.tsx (DustSweeperClient is a client component and can't
// export generateMetadata directly).
export const metadata: Metadata = {
  title: "Dust Sweeper — Consolidate Stranded Token Balances",
  description:
    "Find and consolidate small stranded token balances across Solana and EVM chains into one token, and reclaim rent from empty accounts.",
  alternates: { canonical: "/dust-sweeper" },
};

export default function DustSweeperPage() {
  return <DustSweeperClient />;
}
