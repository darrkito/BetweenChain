import type { Metadata } from "next";
import { EvacClient } from "./EvacClient";

export const metadata: Metadata = {
  title: "Evac Engine — Emergency Wallet Evacuation",
  description: "Move everything in a connected wallet to a safe-haven address in one guided flow, and revoke token approvals you no longer trust.",
  alternates: { canonical: "/evac" },
};

export default function EvacPage() {
  return <EvacClient />;
}
