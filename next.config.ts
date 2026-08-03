import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Dev server is also opened from other devices on the LAN (e.g.
  // http://192.168.100.200:3000) — without this, Next blocks the HMR
  // websocket for any non-localhost origin ("Blocked cross-origin request to
  // Next.js dev resource /_next/webpack-hmr", confirmed live 2026-07-20).
  allowedDevOrigins: ["192.168.100.200"],
  // Added 2026-08-03 (live security review) — the app had ZERO custom
  // security headers before this (confirmed via `curl -I` against
  // production: only Vercel's own default HSTS was present). Deliberately
  // conservative: this is a wallet-connecting dApp that talks to many wallet
  // extensions (Phantom/Slush/MetaMask, which inject their own scripts) and
  // RPC/relay endpoints (Solana/Sui/EVM RPCs, WalletConnect relays, Relay.link,
  // Jupiter, OpenSea, Magic Eden, Tradeport, ChangeNOW) — a strict script-src/
  // connect-src CSP risks silently breaking real wallet-signing flows and
  // can't be safely tightened without live browser testing against every one
  // of those (no browser tooling available in this environment — see
  // STATE.md). These specific headers were chosen because they protect
  // against real, well-understood attack classes (clickjacking against
  // wallet-approve buttons, MIME-sniffing, referrer leakage) with ZERO
  // functional risk — none of them touch which scripts/origins the page can
  // talk to.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Clickjacking: without this, the entire app (including every
          // wallet-connect/sign/buy button) could be embedded in an
          // invisible iframe on an attacker's page and used to trick a
          // user into approving a transaction they think is something
          // else — a real, known attack pattern against crypto dApps
          // specifically. `frame-ancestors 'none'` is the CSP-native form
          // of the same protection (X-Frame-Options is a legacy fallback
          // for browsers that don't honor the CSP directive).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
          // Stops a browser from executing/rendering a response as a
          // different content-type than what the server declared (e.g.
          // treating a user-uploaded/fetched file as HTML/JS).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak the full URL (which can contain quote ids, purchase
          // ids, etc. in query params) to third-party sites via the
          // Referer header when a user clicks an outbound link.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // This app never needs camera/microphone/geolocation — deny them
          // outright rather than leaving the default (which allows same-origin).
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
