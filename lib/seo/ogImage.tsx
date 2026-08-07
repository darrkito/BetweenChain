import { ImageResponse } from "next/og";

// Shared by app/opengraph-image.tsx and app/twitter-image.tsx — same visual,
// two file-convention entry points (Next doesn't auto-reuse one for the
// other). Plain inline styles only: ImageResponse renders via Satori, which
// supports a constrained CSS subset (flexbox layout, no external
// stylesheet/Tailwind class resolution) — matches this app's existing
// brand colors (public/manifest.json: #F5F3FC background, #5B4FE8 accent)
// rather than inventing new ones.
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f5f3fc",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 88,
              height: 88,
              borderRadius: 24,
              backgroundColor: "#5b4fe8",
            }}
          />
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color: "#1a1730" }}>Blockchains.Click</div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 32, color: "#5b4fe8" }}>
          All the blockchains, in just one click.
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE },
  );
}

// 2026-08-06 (blog enrichment pass) — every blog post previously shared this
// site's one static default OG image (the branded card above), so a link
// shared to any post looked identical regardless of what it was about. This
// variant carries the post's own title/category instead, still built from
// the same brand colors/wordmark treatment, same Satori CSS-subset
// constraints as renderOgImage above.
// 2026-08-07 (blog tutorial-hub upgrade) — optional `chains` param draws 2
// real chain icons/labels side by side (e.g. "Solana -> Ethereum") when a
// post is about a specific pair. Omitted, output is byte-identical to
// before this param existed. `iconUrl` values are the same Relay-hosted
// per-chain CDN already used everywhere else in this app
// (lib/chains/swapChains.ts) — Satori (ImageResponse's renderer) fetches
// remote <img> sources directly, same as any other Satori-based OG image.
export function renderBlogOgImage(post: { title: string; category: string; chains?: Array<{ label: string; iconUrl: string }> }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          backgroundColor: "#f5f3fc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              padding: "8px 20px",
              borderRadius: 999,
              backgroundColor: "#ecebfc",
              color: "#5b4fe8",
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            {post.category}
          </div>
          {post.chains && post.chains.length === 2 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 600, color: "#1a1730" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Satori (ImageResponse) is not the Next.js runtime, next/image doesn't apply here */}
              <img src={post.chains[0].iconUrl} width={40} height={40} style={{ borderRadius: 999 }} alt="" />
              <span>{post.chains[0].label}</span>
              <span style={{ color: "#5b4fe8" }}>→</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- Satori (ImageResponse) is not the Next.js runtime, next/image doesn't apply here */}
              <img src={post.chains[1].iconUrl} width={40} height={40} style={{ borderRadius: 999 }} alt="" />
              <span>{post.chains[1].label}</span>
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: post.title.length > 60 ? 52 : 64,
            fontWeight: 700,
            lineHeight: 1.15,
            color: "#1a1730",
            maxWidth: 1000,
          }}
        >
          {post.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", width: 44, height: 44, borderRadius: 12, backgroundColor: "#5b4fe8" }} />
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#1a1730" }}>Blockchains.Click</div>
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE },
  );
}
