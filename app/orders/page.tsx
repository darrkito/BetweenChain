import type { Metadata } from "next";
import { OrdersClient } from "./OrdersClient";

export const metadata: Metadata = {
  title: "Trigger Orders — Solana Limit Orders & DCA",
  description:
    "Set a cross-chain intent: a Solana price target or a recurring DCA schedule, filled automatically by Jupiter's on-chain program even while you're offline. Non-custodial.",
  alternates: { canonical: "/orders" },
};

export default function OrdersPage() {
  return <OrdersClient />;
}
