import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPaymentLink } from "@/lib/payments/links";
import { PayClient } from "./PayClient";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const link = await getPaymentLink(id);
  if (!link) return { title: "Payment link not found" };
  const amount = link.amount_requested ? `${link.amount_requested} ${link.dest_token_symbol}` : "any amount";
  return {
    title: `Pay ${amount}${link.label ? ` — ${link.label}` : ""}`,
    description: "Pay with whatever you hold on Solana or any connected EVM chain — routed and delivered automatically.",
    alternates: { canonical: `/pay/${id}` },
  };
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = await getPaymentLink(id);
  if (!link) notFound();
  return <PayClient link={link} />;
}
