import type { Metadata } from "next";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { SITE_X_URL, SITE_X_HANDLE } from "@/app/components/SocialXLink";

export const metadata: Metadata = {
  title: "About",
  description: "What Blockchains.Click is: a non-custodial cross-chain swap and NFT marketplace covering Solana, EVM chains, and Sui.",
  alternates: { canonical: "/about" },
};

const BREADCRUMB_ITEMS = [
  { label: "Home", href: "/" },
  { label: "About" },
];

// Real facts only — no company name, team bios, or physical address exist
// for this project (same no-fabrication stance as app/privacy/page.tsx and
// lib/seo/jsonld.tsx's organizationSchema comment). This page describes the
// product itself, not an invented corporate entity.
export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">About Blockchains.Click</h1>
        </div>

        <div className="flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">What this is</h2>
            <p className="max-w-[65ch]">
              Blockchains.Click is a cross-chain token swap tool: swap between Solana and EVM chains
              non-custodially via Jupiter and Relay, or move BTC/ETH/SOL into Sui via ChangeNOW where a
              non-custodial route doesn&apos;t exist yet. A separate NFT marketplace covers Solana, EVM chains,
              and Sui collections. Platform fee is 0.25% per swap leg, plus the underlying chain&apos;s network fee
              — no other platform fee.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Who runs it</h2>
            <p className="max-w-[65ch]">
              This is an independent, open-source project — not a registered company, and there&apos;s no
              storefront or physical address to list. The code is public on GitHub, so the actual behavior of the
              app can be verified directly rather than taken on trust. See the{" "}
              <a
                href="https://github.com/darrkito/BetweenChain"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                source on GitHub
              </a>{" "}
              and the <a href="/security" className="text-accent underline-offset-4 hover:underline">Security</a> page
              for the real threat model this app is built around.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Get in touch</h2>
            <p className="max-w-[65ch]">
              The fastest way to reach us is{" "}
              <a href={SITE_X_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                {SITE_X_HANDLE} on X
              </a>{" "}
              or by opening an issue on the GitHub repo linked above.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
