import type { Metadata } from "next";
import { CreatePayLinkClient } from "./CreatePayLinkClient";

export const metadata: Metadata = {
  title: "Create a ClickPay Link",
  description: "Generate a shareable payment link — get paid in the exact token and chain you want, from whatever the payer holds.",
  alternates: { canonical: "/pay/create" },
};

export default function CreatePayLinkPage() {
  return <CreatePayLinkClient />;
}
