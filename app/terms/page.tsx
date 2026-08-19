import type { Metadata } from "next";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { JsonLd, breadcrumbListSchema } from "@/lib/seo/jsonld";

const SITE_URL = "https://blockchains.click";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "The real terms of using Blockchains.Click — fees, custody model, risk, and what you're agreeing to.",
  alternates: { canonical: "/terms" },
};

const BREADCRUMB_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Terms & Conditions" },
];

// See app/privacy/page.tsx's own doc for the same caveat here: this
// describes what the app's own code actually does (checked against the
// real fee model in lib/fees.ts, the ChangeNOW custodial disclosure
// already documented in lib/chains/changenow.ts, and the real
// points/referral schema) rather than generic boilerplate -- but it is
// NOT a substitute for real legal review, and deliberately states no
// specific legal entity name, registered address, or governing-law
// jurisdiction, since none was ever established anywhere in this
// codebase and inventing one would be fabrication. Add real entity/
// jurisdiction details, and have this reviewed by an actual lawyer,
// before treating this as a complete legal document.
export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">Terms &amp; Conditions</h1>
          <p className="text-sm text-ink-faint">Last updated August 19, 2026</p>
        </div>

        <div className="flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">What Blockchains.Click is</h2>
            <p className="max-w-[65ch]">
              A cross-chain token swap tool and NFT marketplace. You connect (or paste an address for) your own
              wallet, sign your own transactions, and this app routes them through Jupiter, Relay, or ChangeNOW
              depending on the pair. By using it, you agree to the terms below.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Fees</h2>
            <p className="max-w-[65ch]">
              Solana/EVM swaps and NFT purchases (Jupiter/Relay) carry a flat 0.25% platform fee per leg, plus the
              underlying network&apos;s own gas fee. A same-chain purchase (paying in the NFT&apos;s own native token)
              has no cross-chain leg and no platform fee. Bitcoin and Sui swaps (ChangeNOW) carry no separate
              Blockchains.Click platform fee — you pay ChangeNOW&apos;s own live exchange rate instead. Every fee is
              shown in the quote before you sign or send anything; nothing is charged that wasn&apos;t disclosed
              upfront.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Custody — read this if you&apos;re swapping Bitcoin or Sui</h2>
            <p className="max-w-[65ch]">
              Solana/EVM swaps and NFT purchases are non-custodial end to end — you sign every transaction yourself,
              and this app never holds your funds. Bitcoin and Sui swaps are different: you send your deposit to an
              address controlled by ChangeNOW, a real third-party exchange, and ChangeNOW delivers the destination
              asset afterward. That deposit is genuinely custodial to ChangeNOW for the time in between — the same
              category of counterparty risk as using any centralized exchange. It is never custodial to
              Blockchains.Click at any point. If ChangeNOW fails to deliver, your recourse is with ChangeNOW, not
              this app.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">No investment advice, use at your own risk</h2>
            <p className="max-w-[65ch]">
              Nothing on this site is financial or investment advice. Cryptoasset prices are volatile, quotes can
              move between preview and execution, and on-chain transactions are generally irreversible once
              confirmed. You&apos;re responsible for verifying the destination address, the amount, and the token
              before signing anything.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Points and referrals</h2>
            <p className="max-w-[65ch]">
              Points earned on trading volume, and referral bonuses, have no cash value, aren&apos;t a security or
              financial instrument, and aren&apos;t redeemable for currency. The points/referral program can change
              or end at any time.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Your responsibility</h2>
            <p className="max-w-[65ch]">
              You&apos;re responsible for complying with the laws that apply to you — including any restrictions on
              cryptoasset use in your jurisdiction, and sanctions/export-control rules. Don&apos;t use this app for
              anything illegal, including money laundering or evading sanctions.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">No warranty, limitation of liability</h2>
            <p className="max-w-[65ch]">
              This app is provided &quot;as is,&quot; with no guarantee it&apos;s uninterrupted or error-free.
              Third-party engines (Jupiter, Relay, ChangeNOW) and the underlying blockchains themselves are outside
              this app&apos;s control. To the fullest extent the law allows, Blockchains.Click isn&apos;t liable for
              losses arising from using it, including from a third-party engine&apos;s failure, network congestion, or
              your own error (wrong address, wrong amount).
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">Changes</h2>
            <p className="max-w-[65ch]">
              These terms may be updated as the app changes — the date at the top of this page reflects the last
              real revision.
            </p>
          </section>
        </div>
      </div>

      <JsonLd data={breadcrumbListSchema(BREADCRUMB_ITEMS, `${SITE_URL}/terms`)} />
    </main>
  );
}
