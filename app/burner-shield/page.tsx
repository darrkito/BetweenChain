import type { Metadata } from "next";
import { BurnerShieldClient } from "./BurnerShieldClient";

export const metadata: Metadata = {
  title: "Burner Shield — Check a Contract Before You Sign",
  description: "Real risk-flag check for a contract or token address, backed by GoPlus Security's public data — know before you sign.",
  alternates: { canonical: "/burner-shield" },
};

export default function BurnerShieldPage() {
  return <BurnerShieldClient />;
}
