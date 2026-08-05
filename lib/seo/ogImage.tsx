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
