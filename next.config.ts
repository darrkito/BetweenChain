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
  // Added 2026-08-03 (live security review), Content-Security-Policy REMOVED
  // 2026-08-04 (real live bug found) — the app had ZERO custom security
  // headers before this pass (confirmed via `curl -I` against production:
  // only Vercel's own default HSTS was present). A `Content-Security-Policy:
  // frame-ancestors 'none'; object-src 'none'; base-uri 'self'` header was
  // added alongside the headers below, deliberately WITHOUT a script-src/
  // connect-src restriction — but even that minimal policy broke the app
  // live: confirmed via the user's real browser console, Chrome's own CSP
  // enforcement blocked `eval()` under a `script-src` directive this app
  // never even specified (Next.js App Router auto-augments a
  // user-supplied CSP with its own script-src/nonce handling once ANY CSP
  // header is present, rather than leaving unspecified directives
  // unrestricted the way a plain CSP normally would). Wallet-adapter/viem's
  // dependency chain uses `eval`/`Function()` internally (common in
  // elliptic-curve crypto libraries) — blocking it crashed wallet
  // initialization early enough in the provider tree to cascade into the
  // header/connect-wallet buttons never rendering, the same "one crash
  // near the root, whole app looks broken" pattern already documented once
  // in this file's own history (the data-theme hydration bug). Removed
  // entirely rather than trying to special-case `unsafe-eval` — this
  // exact failure mode is why the original comment here said a CSP
  // "can't be safely tightened without live browser testing" up front; now
  // confirmed the hard way. The remaining headers below don't touch script
  // execution or CSP at all and are unaffected — kept.
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
          // specifically. Plain X-Frame-Options only (not also a CSP
          // frame-ancestors directive) — see the CSP note above for why
          // any Content-Security-Policy header is avoided here now.
          { key: "X-Frame-Options", value: "DENY" },
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
