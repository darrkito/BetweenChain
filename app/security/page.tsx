import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";

export const metadata: Metadata = {
  title: "Security",
  description: "How Blockchains.Click protects your funds: non-custodial signing, destination-address binding, and where the one custodial step in the app actually is.",
  alternates: { canonical: "/security" },
};

const BREADCRUMB_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Security" },
];

// Public-facing summary of the real threat model documented in SECURITY.md — deliberately
// leaves out the dependency-CVE / open-gap tracking that lives there (that's an internal
// engineering log, not something to hand an attacker as a public roadmap). Every claim
// below is checked against SECURITY.md's actual entries, not written from scratch.
export default function SecurityPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">Security</h1>
          <p className="text-sm text-ink-faint">Last updated August 27, 2026</p>
        </div>

        <div className="flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">The short version</h2>
            <p className="max-w-[65ch]">
              We never hold your private keys or seed phrase — every swap and purchase is signed in your own wallet.
              Once you get a quote, the destination address is locked in on our side and can&apos;t be changed by
              anyone, including us, before execution. The one place this app does involve a third party holding
              funds briefly is disclosed below, not hidden.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Destination-address binding</h2>
            <p className="max-w-[65ch]">
              When you request a quote, the destination address and amount are locked into that quote at the moment
              it&apos;s created. Every later step reads the destination back from that locked record — it is never
              re-accepted from your browser again. This is the specific protection against a &quot;man-in-the-middle
              swaps your destination address mid-transaction&quot; attack, which was the core threat this app was
              designed around from day one.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Two different trust models, by rail</h2>
            <ul className="flex flex-col gap-2 pl-4 [&>li]:list-disc">
              <li>
                <strong className="text-ink">Solana ↔ EVM swaps (Jupiter/Relay).</strong> Fully non-custodial — your
                wallet calls the bridge&apos;s smart contract directly. We never take custody of your funds at any
                point.
              </li>
              <li>
                <strong className="text-ink">BTC/ETH/SOL → Sui purchases (ChangeNOW).</strong> Relay has no Sui
                support, so this path uses ChangeNOW, a custodial exchange: you send funds to a deposit address it
                controls, and it sends Sui back to you afterward — the same kind of counterparty trust as using a
                centralized exchange to convert currency, not a trustless bridge. We disclose this plainly rather
                than implying every path in the app works the same way. Your own Sui wallet still signs the final
                purchase, so funds can never be silently redirected mid-flow on our end.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Verified on real transactions, not just in theory</h2>
            <p className="max-w-[65ch]">
              This runs on Solana mainnet with real funds, not a testnet. Swaps have been run and independently
              verified directly on-chain — checking actual transaction receipts and wallet balances via public RPC
              endpoints, not just trusting what our own database says happened.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">The code is public</h2>
            <p className="max-w-[65ch]">
              This app&apos;s source is open on GitHub — you don&apos;t have to take our word for any of the above.{" "}
              <a
                href="https://github.com/darrkito/BetweenChain"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Read the code yourself
              </a>
              .
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Related</h2>
            <p className="max-w-[65ch]">
              See <Link href="/privacy" className="text-accent hover:underline">Privacy</Link> for what data we
              collect, and <Link href="/terms" className="text-accent hover:underline">Terms</Link> for the full
              terms of use.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
