import type { Metadata } from "next";
import { RadarClient } from "./RadarClient";

// Thin Server Component wrapper purely for real metadata — same split as
// app/swap/page.tsx (RadarClient is a client component and can't export
// generateMetadata directly).
export const metadata: Metadata = {
  title: "Meme Radar",
  description:
    "Trending Solana tokens with real RugCheck safety data — quick-buy with a review step, no blind signing.",
  alternates: { canonical: "/radar" },
};

export default function RadarPage() {
  return <RadarClient />;
}
