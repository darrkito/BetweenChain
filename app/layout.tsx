import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Providers } from "./providers";
import { JsonLd, siteGraphSchema } from "@/lib/seo/jsonld";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 2026-08-05 (SEO foundation pass) — this app had almost no metadata before
// this: title/description/manifest only, no metadataBase (so any relative
// OG/canonical URL Next tried to resolve would have been wrong), no OG/
// Twitter defaults, no title template for child pages. Ported from
// /home/darrkito/luvory-genius-generator's real, working SEO setup (a full
// audit this session confirmed its actual techniques, not just its stack) —
// ITS mechanism (Vite + a custom prerender script + react-helmet-async) is
// Next-irrelevant, but the CONTENT pattern (title template, full OG/Twitter
// blocks, a permissive robots directive opting into full search-result
// previews) carries over directly onto Next's native Metadata API.
const SITE_URL = "https://blockchains.click";
const SITE_DESCRIPTION = "All the blockchains, in just one click. Swap meme coins across chains, starting from Solana.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Blockchains.Click", template: "%s | Blockchains.Click" },
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  // apple-icon.png / icon.svg are picked up automatically from app/ by
  // Next.js's file-based icon convention — no explicit `icons` entry needed
  // here for those. public/manifest.json carries the PWA install icon set
  // (192/512/maskable) separately, since that's a distinct spec from the
  // favicon/apple-touch-icon Next.js's own convention covers.
  openGraph: {
    type: "website",
    siteName: "Blockchains.Click",
    title: "Blockchains.Click",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    // app/opengraph-image.tsx (same directory, Next's file convention) is
    // picked up automatically — no explicit `images` entry needed here.
  },
  twitter: {
    card: "summary_large_image",
    title: "Blockchains.Click",
    description: SITE_DESCRIPTION,
    // app/twitter-image.tsx is picked up the same way as opengraph-image.tsx.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Opts into full-content previews in search results (snippet length,
      // image preview size, video preview length) instead of Google's
      // default truncated ones — same directive Luvory's real setup uses.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

// Added 2026-08-03 — this app had no viewport export at all before (Next's
// bare default has no `viewportFit`/`themeColor`). `viewportFit: "cover"`
// lets fixed-position UI (the header, every modal in this app) actually
// extend under an iOS notch/home-indicator safe area rather than leaving a
// dead strip, IF a component opts in with `env(safe-area-inset-*)` padding —
// this only makes that possible, doesn't add the padding itself (no
// full-bleed fixed UI needed it yet). `themeColor` is split light/dark to
// match this app's existing `prefers-color-scheme`-only theming
// (globals.css's `--accent` values) — controls the mobile browser chrome
// color, not page content.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5b4fe8" },
    { media: "(prefers-color-scheme: dark)", color: "#8b7fff" },
  ],
};

// Runs synchronously before hydration/first paint (inline `<script>` in
// `<head>`, not a normal React effect) — reads the same "sbc-theme"
// localStorage key lib/client/ThemeToggle.tsx writes to and sets
// `data-theme` on <html> immediately. Without this, a user who picked
// "dark" would see a flash of the light theme (or vice versa) on every page
// load until ThemeToggle's own effect ran client-side. Wrapped in try/catch
// since localStorage can throw in some privacy-mode/sandboxed contexts —
// falls through to the "system" default (no attribute set) rather than
// breaking the page.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("sbc-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Real bug found live 2026-08-03: THEME_INIT_SCRIPT below intentionally
      // mutates this element's `data-theme` attribute BEFORE React hydrates
      // (that's the whole point — it prevents a flash of the wrong theme).
      // But that means the server-rendered HTML (no data-theme attribute,
      // the server has no idea what's in the visitor's localStorage) and the
      // real DOM at hydration time (data-theme already set by the script)
      // never match on this exact element. React correctly flagged that as a
      // hydration mismatch and gave up patching the tree — which cascaded
      // into a broken app: wallet lists never populated, the connect button
      // rendered unstyled, since large parts of the client tree downstream
      // never finished hydrating. `suppressHydrationWarning` here is the
      // standard, documented fix for this exact pattern (every dark-mode
      // pre-hydration-script guide calls this out) — it only suppresses the
      // warning/mismatch-abort for this one element's own attributes, not
      // for anything inside it, so a real mismatch elsewhere in the tree
      // still surfaces normally.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Site-wide Organization+WebSite JSON-LD — every other page's own
            JSON-LD (breadcrumbs, FAQPage, BlogPosting) cross-links to these
            @id values rather than repeating them, same @graph pattern
            lib/seo/jsonld.tsx ports from Luvory's real SEO setup. */}
        <JsonLd data={siteGraphSchema()} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
        {/* 2026-08-04 (reliability/observability pass) — this app had zero
            real-user visibility before this: no error tracking, no
            performance monitoring, console.log/warn only. These two are
            Vercel-native (tied to the existing project, no new account/DSN
            needed) and give real Core Web Vitals + traffic visibility.
            Dedicated error tracking (e.g. Sentry) still needs its own
            account — flagged as a follow-up, not something addable without
            the user creating one. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
