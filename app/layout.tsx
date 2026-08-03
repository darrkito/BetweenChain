import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SwapperBetweenChains",
  description: "Swap meme coins across chains, starting from Solana.",
  manifest: "/manifest.json",
  // apple-icon.png / icon.svg are picked up automatically from app/ by
  // Next.js's file-based icon convention — no explicit `icons` entry needed
  // here for those. public/manifest.json carries the PWA install icon set
  // (192/512/maskable) separately, since that's a distinct spec from the
  // favicon/apple-touch-icon Next.js's own convention covers.
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
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
