import type { Metadata } from "next";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { SITE_X_URL, SITE_X_HANDLE } from "@/app/components/SocialXLink";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Blockchains.Click: X (Twitter) or the public GitHub repository.",
  alternates: { canonical: "/contact" },
};

const BREADCRUMB_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Contact" },
];

// No support email or phone exists for this project — same no-fabrication
// stance as app/about/page.tsx and lib/seo/jsonld.tsx's organizationSchema
// comment. These two channels are the real, currently-existing ones.
export default function ContactPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">Contact</h1>
        </div>

        <div className="flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">X (Twitter)</h2>
            <p className="max-w-[65ch]">
              The fastest way to reach us — general questions, bug reports, or feedback.{" "}
              <a href={SITE_X_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                {SITE_X_HANDLE}
              </a>
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">GitHub</h2>
            <p className="max-w-[65ch]">
              For a technical bug report, a security concern, or to read the actual source code that runs this
              app.{" "}
              <a
                href="https://github.com/darrkito/BetweenChain"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                github.com/darrkito/BetweenChain
              </a>
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">No email or phone support</h2>
            <p className="max-w-[65ch]">
              This is an independent, open-source project — there&apos;s no support desk, phone line, or company
              email to list. The two channels above are the real ones.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
