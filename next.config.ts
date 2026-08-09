import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // 2026-08-04 — next/image requires every remote host allowlisted up front.
  // Only Relay's own hosted chain-icon assets (a single fixed host, used by
  // EvmChainSubTabs/NftChainTabs) qualify for this. Token logos and NFT
  // media (TokenIcon, NftImage, NftCollectionHero, NftCollectionsGrid) come
  // from a genuinely unbounded set of third-party hosts (IPFS gateways,
  // arbitrary marketplace CDNs, whatever URL a token/collection creator set)
  // — those correctly stay as plain `<img>` (see each component's own
  // eslint-disable comment) rather than either a brittle allowlist that
  // breaks on every new host, or a wildcard hostname pattern that would let
  // Vercel's Image Optimization API fetch/proxy literally any URL.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "assets.relay.link" },
      // Sui's chain-icon (lib/nft/labels.ts's SUI_ICON_URL) — the one
      // exception to "chain icons are all Relay-hosted," a single fixed
      // CoinGecko coin-image URL, not an unbounded per-token/per-collection
      // source like TokenIcon/NftImage.
      { protocol: "https", hostname: "coin-images.coingecko.com" },
    ],
    // 2026-08-05 (real cost issue: Vercel's free-tier Image Optimization
    // "Cache Writes" quota, 100K/month, exceeded at 124K) — neither of these
    // had ever been set, so both were on Next's defaults, which are wrong
    // for this app's actual usage:
    //
    // minimumCacheTTL defaults to 60s. NFT/collection images are
    // effectively immutable (an NFT's image essentially never changes
    // post-mint — see NftImage.tsx's own comment on this) but were being
    // treated as if they could change every minute, forcing a fresh
    // optimization ("cache write") on every re-request past that window.
    // Raised to 1 year — the correct value for genuinely-static content,
    // not a workaround.
    //
    // deviceSizes/imageSizes default to 8+8=16 breakpoints each, up to
    // 3840px — this app's actual `sizes` hints (grep for `sizes=` across
    // app/components/) never request anything above 768px (the collection
    // hero banner) or below ~64px; every listing/browse thumbnail sits in
    // the 96-256px range. Every unused breakpoint was its own separate
    // cache-write cost per unique image, for widths this app never
    // actually serves. Trimmed to the set that covers real usage
    // (including ~2x device-pixel-ratio headroom on the 768px hero).
    minimumCacheTTL: 31536000,
    deviceSizes: [640, 750, 828, 1080],
    imageSizes: [64, 96, 128, 220, 256, 384],
    // 2026-08-04 — next/image also allowlists LOCAL (same-origin) image
    // paths, separate from remotePatterns above. Its default local pattern
    // only matches an empty query string (`search: ''`), which silently
    // rejects /api/img?url=... (real error: `"url" parameter is not
    // allowed`, easy to misdiagnose as the SSRF-guard error below since
    // both share that exact message text). Omitting `search` here skips
    // that exact-match check entirely — safe because app/api/img/route.ts
    // is the only local path that ever needs an arbitrary query value, and
    // it independently validates/blocks the actual `url` value itself
    // (private IPs, protocol, redirects, content-type — see that file).
    localPatterns: [{ pathname: "/api/img" }],
    // 2026-08-09 — real, live-confirmed platform bug: Vercel's builder was
    // failing to package the /_next/image optimization lambda
    // ("Cannot find module './.next/server/pages/_next/image.js'"),
    // 500ing every optimized image site-wide since 2026-08-04. Forcing
    // `next build --webpack` (package.json) did NOT fix it — confirmed via
    // Vercel's own runtime error tracker still showing the same error on
    // the webpack-built deployment. Disabling Next's built-in optimizer
    // entirely bypasses the broken code path altogether. app/api/img's own
    // Cache-Control (1yr, immutable — see that route) already provides the
    // real caching benefit; the only thing lost is automatic resize/format
    // conversion, an acceptable trade for images that actually load.
    unoptimized: true,
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
  // live: Chrome's CSP enforcement blocked `eval()` even though this app
  // never specified a script-src at all (Next.js App Router auto-augments
  // a user-supplied CSP with its own script-src/nonce handling once ANY CSP
  // header is present). Wallet-adapter/viem's dependency chain uses
  // `eval`/`Function()` internally — this crashed wallet init early enough
  // to cascade into the header/connect-wallet buttons never rendering.
  //
  // 2026-08-04 (final security hardening pass, SAME DAY) — attempted a real
  // fix (explicit `script-src 'self' 'unsafe-eval' 'unsafe-inline'` instead
  // of omitting script-src and hitting Next's auto-augmentation blind) and
  // then REVERTED it before shipping, per [[feedback_verify_untested_headers_before_prod]]
  // — a memory this exact incident already produced. That memory's own
  // explicit guidance: a change whose safety depends on live browser
  // behavior, shipped with a self-acknowledged "can't verify this without
  // browser testing" caveat, is precisely the failure mode that broke this
  // app once already. Checked for real: attempted to use claude-in-chrome
  // this session — genuinely not available (extension not connected), not
  // a convenient excuse. Rather than repeat the exact mistake, the CSP
  // stays OFF. A specific, ready-to-apply candidate exists (a
  // `script-src 'self' 'unsafe-eval' 'unsafe-inline'; object-src 'none';
  // base-uri 'self'; frame-ancestors 'none'` policy — grants unsafe-eval
  // explicitly instead of omitting script-src, which should avoid Next's
  // auto-augmentation collision) but needs a real browser (either the user
  // testing it live, or a future session with working browser tooling)
  // BEFORE it ships, not after.
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
