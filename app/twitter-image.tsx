import { renderOgImage, OG_IMAGE_SIZE } from "@/lib/seo/ogImage";

// See app/opengraph-image.tsx's identical comment — same Turbopack+edge-
// runtime bug, same fix.
export const runtime = "nodejs";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage();
}
