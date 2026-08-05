import { renderOgImage, OG_IMAGE_SIZE } from "@/lib/seo/ogImage";

// Explicit — a known Turbopack+edge-runtime bug with next/og's ImageResponse
// ("failed to pipe response", confirmed live 2026-08-05 in this exact dev
// server) is avoided by forcing Node.js runtime instead of leaving it to
// infer a default.
export const runtime = "nodejs";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage();
}
