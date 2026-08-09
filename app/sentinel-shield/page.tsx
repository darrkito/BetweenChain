import type { Metadata } from "next";
import { SentinelShieldClient } from "./SentinelShieldClient";

export const metadata: Metadata = {
  title: "Sentinel Shield — Aave Health Factor Monitor",
  description: "Live Aave health-factor monitoring across Ethereum, Arbitrum, and Base. Read-only — know your liquidation risk before it's too late.",
  alternates: { canonical: "/sentinel-shield" },
};

export default function SentinelShieldPage() {
  return <SentinelShieldClient />;
}
