import type { Metadata } from "next";
import { RebalanceClient } from "./RebalanceClient";

export const metadata: Metadata = {
  title: "Portfolio Rebalancer — Rebalance Your Wallet",
  description: "Set target allocations across what you hold and rebalance into place with real USD-value deltas — a guided swap sequence, no custody, no relayer required.",
  alternates: { canonical: "/rebalance" },
};

export default function RebalancePage() {
  return <RebalanceClient />;
}
