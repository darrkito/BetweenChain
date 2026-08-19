import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { JsonLd, breadcrumbListSchema } from "@/lib/seo/jsonld";

const SITE_URL = "https://blockchains.click";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Blockchains.Click collects, why, and how it's used — wallet addresses, on-chain activity, and analytics.",
  alternates: { canonical: "/privacy" },
};

const BREADCRUMB_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Privacy Policy" },
];

// 2026-08-19 (SEO checklist audit) — real gap: this app had no Privacy
// Policy or Terms page at all. Written to describe what this app's own
// code actually does (checked against supabase/migrations/0001_init.sql's
// real schema, app/layout.tsx's real analytics scripts, and the
// wallet-signature auth flow) rather than generic boilerplate copied from
// elsewhere -- but this is NOT a substitute for real legal review. No
// specific legal entity name, registered address, or governing-law
// jurisdiction is stated here since none was ever established anywhere in
// this codebase -- inventing one would be the same class of mistake this
// session's SEO audit already flagged and fixed elsewhere (see llms.txt's
// history): don't fabricate a fact that isn't actually known. Add real
// entity/jurisdiction details, and have this reviewed by an actual lawyer,
// before treating this as a complete legal document.
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">Privacy Policy</h1>
          <p className="text-sm text-ink-faint">Last updated August 19, 2026</p>
        </div>

        <div className="flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">The short version</h2>
            <p className="max-w-[65ch]">
              Blockchains.Click doesn&apos;t ask for your name, email, or a password. You sign in by signing a message
              with your Solana or EVM wallet — we store the public wallet address that produces, not any identifying
              information tied to it. This page explains exactly what is collected, why, and who else sees it.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">What we collect</h2>
            <ul className="flex flex-col gap-2 pl-4 [&>li]:list-disc">
              <li>
                <strong className="text-ink">Wallet addresses.</strong> Your Solana public key (used for sign-in) and,
                if you use one, an EVM address you&apos;ve pasted or connected as a destination. Both are public
                on-chain data, not secrets.
              </li>
              <li>
                <strong className="text-ink">Swap and purchase records.</strong> Quotes, transaction status, and
                amounts for swaps and NFT purchases you make through the app — needed to actually deliver what you
                paid for and to credit points.
              </li>
              <li>
                <strong className="text-ink">Points and referral data.</strong> Your points balance, referral code,
                and which wallet referred which.
              </li>
              <li>
                <strong className="text-ink">A session cookie.</strong> An HttpOnly cookie holding a signed token that
                proves you own the wallet you signed in with — it doesn&apos;t contain a password or private key
                (this app never sees your private key or seed phrase, full stop).
              </li>
              <li>
                <strong className="text-ink">Basic analytics.</strong> Google Analytics (GA4) and Vercel Analytics —
                standard page-view/traffic data, not tied to a wallet address.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">What we don&apos;t collect</h2>
            <p className="max-w-[65ch]">
              No name, email, phone number, government ID, or KYC documentation. No private keys or seed phrases —
              every transaction is signed in your own wallet, never by us. We don&apos;t sell personal data, because
              we don&apos;t have the kind of personal data that gets sold.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Who else sees it</h2>
            <p className="max-w-[65ch]">
              Executing a swap or purchase means the relevant amounts and destination address necessarily pass
              through the engine that executes it:
            </p>
            <ul className="flex flex-col gap-2 pl-4 [&>li]:list-disc">
              <li>
                <strong className="text-ink">Jupiter and Relay</strong> for Solana/EVM swaps and NFT purchases — both
                non-custodial; they never hold your funds, only route a wallet-signed transaction.
              </li>
              <li>
                <strong className="text-ink">ChangeNOW</strong> for Bitcoin and Sui swaps specifically — a real,
                separate exchange. Unlike Jupiter/Relay, this leg is custodial: your deposit briefly sits with
                ChangeNOW before it delivers the destination asset. See{" "}
                <Link href="/blog/how-to-swap-bitcoin-cross-chain" className="text-accent hover:underline">
                  how a ChangeNOW-routed swap works
                </Link>{" "}
                for the full mechanics.
              </li>
              <li>
                <strong className="text-ink">Supabase</strong> hosts the database (wallet addresses, swap/points
                records) and issues the session token. <strong className="text-ink">Vercel</strong> hosts the app
                itself and its own analytics.
              </li>
            </ul>
            <p className="max-w-[65ch]">
              None of this data is sold to third parties. It exists to make the app function and to credit points
              correctly.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">On-chain data</h2>
            <p className="max-w-[65ch]">
              Every transaction you sign is public and permanent on its own blockchain, independent of anything this
              app stores — that&apos;s true of any wallet-based app, not specific to us, and it means on-chain history
              can&apos;t be deleted even if you ask us to delete your off-chain account data.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Your choices</h2>
            <p className="max-w-[65ch]">
              You can stop using the app at any time — nothing persists beyond your wallet address and transaction
              history in our database. Reach out via{" "}
              <a
                href="https://x.com/blocksdotclick"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                @blocksdotclick
              </a>{" "}
              if you want your off-chain account record (points/referral data, not on-chain history) deleted.
            </p>
          </section>
        </div>
      </div>

      <JsonLd data={breadcrumbListSchema(BREADCRUMB_ITEMS, `${SITE_URL}/privacy`)} />
    </main>
  );
}
