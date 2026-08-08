import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBasket, getAllBaskets } from "@/lib/content/baskets";
import { BasketClient } from "./BasketClient";

export function generateStaticParams() {
  return getAllBaskets().map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const basket = getBasket(slug);
  if (!basket) return { title: "Basket not found" };
  return {
    title: `${basket.name} — Portfolio Basket`,
    description: basket.description,
    alternates: { canonical: `/basket/${basket.slug}` },
  };
}

export default async function BasketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const basket = getBasket(slug);
  if (!basket) notFound();
  return <BasketClient basket={basket} />;
}
