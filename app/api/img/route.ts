import "server-only";
import sharp from "sharp";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 15;

/**
 * Same-origin image proxy — lets next/image serve NFT/token images that come
 * from a genuinely unbounded set of external hosts (IPFS gateways, arbitrary
 * marketplace CDNs) without needing every one of those hosts allowlisted in
 * next.config.ts's remotePatterns. next/image only ever sees THIS route as
 * the "remote" host (same-origin, so no remotePatterns entry needed at all)
 * — the unbounded part is fully contained inside this one route instead of
 * spilling into next/image's global config. Caching is via the
 * Cache-Control header below (Vercel's CDN honors it for GET route
 * responses) — deliberately NOT lib/cache.ts (that's a single-instance
 * in-memory Map; caching multi-MB image bytes there would balloon RAM per
 * instance) and NOT Upstash/Redis (wrong tool for binary blobs — see the
 * conversation this route was built from).
 *
 * Security note: this is an authenticated-by-nobody "fetch any URL and
 * return it" endpoint, the classic SSRF/open-relay shape. Mitigations below:
 * rate limiting, protocol allowlist, private/loopback/link-local hostname
 * blocking (re-checked on every redirect hop, not just the initial URL),
 * a fetch timeout, a response-size cap, and requiring the upstream response
 * to actually claim an image/* content-type. KNOWN RESIDUAL RISK, not
 * fully closed: DNS rebinding — a hostname can pass the literal-string check
 * below and still resolve to a private IP at TCP-connect time, since we
 * don't control DNS resolution ourselves inside fetch(). Accepted here
 * because the blast radius is narrow even if that happens (the response
 * still has to look like an image/* to be returned at all, so this can't be
 * used to exfiltrate arbitrary internal API/JSON responses) — revisit with a
 * custom resolver + IP-pinned connection if this app's threat model
 * changes.
 *
 * Resizing (2026-08-18, Lighthouse perf pass) — next.config.ts's
 * `images.unoptimized: true` (a required workaround for a real Next
 * 16/Vercel platform bug, see that file's own comment) means next/image
 * NEVER resizes/reencodes anything, including images served through this
 * proxy — confirmed live via Lighthouse on /swap: an 18x18 CSS-displayed
 * token icon was shipping its full 1000x1000 original (115 KiB for one
 * icon). Since this route already owns the only server-side touchpoint
 * every proxied image passes through, it does the resizing itself now via
 * `sharp` (same version Next already vendors for its own optimizer) —
 * optional `?w=` query param, re-encoded to WebP. SVGs and GIFs are left
 * untouched (SVG is already vector/tiny; resizing a GIF would flatten any
 * animation) — the images actually flagged as oversized were all raster
 * (PNG/JPEG token logos), not either of those.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_BYTES = 15 * 1024 * 1024; // generous for NFT art, still bounded
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MIN_RESIZE_WIDTH = 8;
const MAX_RESIZE_WIDTH = 512; // well above every real on-screen use (largest is SwapPanel's 32px icons at 2x-3x DPR)
const RESIZE_SKIP_CONTENT_TYPES = new Set(["image/svg+xml", "image/gif"]);
// 2026-08-05 (real cost issue: Vercel Image Optimization "Cache Writes"
// quota exceeded) — raised from max-age=86400 (1 day). Confirmed live:
// next/image's `minimumCacheTTL` (next.config.ts, set to 1 year the same
// pass) takes the SHORTER of its own configured value and this upstream
// response's max-age — a 1-day cap here was silently overriding the whole
// point of that change, forcing re-optimization ("cache write") on every
// image once a day regardless. NFT images are effectively immutable (an
// NFT's image essentially never changes post-mint), so both should agree
// on the same long duration now.
const CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable";

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local")) return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918 private
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 private
    if (a === 192 && b === 168) return true; // RFC1918 private
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
    if (a === 0) return true;
  }
  // IPv6 loopback / link-local / unique-local
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;

  return false;
}

function isSafeUrl(url: URL): boolean {
  return ALLOWED_PROTOCOLS.has(url.protocol) && !isBlockedHostname(url.hostname);
}

async function fetchFollowingSafeRedirects(initial: URL, signal: AbortSignal): Promise<Response> {
  let current = initial;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeUrl(current)) {
      throw new Error("blocked-url");
    }
    const res = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Blockchains.Click-ImageProxy/1.0" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect-no-location");
      current = new URL(location, current);
      continue;
    }
    return res;
  }
  throw new Error("too-many-redirects");
}

export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "img"), 120, 60_000);
  if (!rl.ok) return new Response("Too many requests", { status: 429 });

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (!isSafeUrl(parsed)) return new Response("Blocked host", { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetchFollowingSafeRedirects(parsed, controller.signal);
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    return new Response("Upstream error", { status: upstream.status === 404 ? 404 : 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return new Response("Not an image", { status: 415 });
  }

  const contentLength = upstream.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    return new Response("Image too large", { status: 413 });
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return new Response("Image too large", { status: 413 });
  }

  const widthRaw = reqUrl.searchParams.get("w");
  const requestedWidth = widthRaw ? Number(widthRaw) : null;
  const canResize =
    requestedWidth != null &&
    Number.isInteger(requestedWidth) &&
    requestedWidth >= MIN_RESIZE_WIDTH &&
    requestedWidth <= MAX_RESIZE_WIDTH &&
    !RESIZE_SKIP_CONTENT_TYPES.has(contentType.toLowerCase().split(";")[0].trim());

  if (canResize) {
    try {
      const resized = await sharp(Buffer.from(buf))
        .resize({ width: requestedWidth, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      return new Response(resized, {
        status: 200,
        headers: { "Content-Type": "image/webp", "Cache-Control": CACHE_CONTROL },
      });
    } catch {
      // Malformed/unsupported-by-sharp source image — fall through and
      // serve the original bytes rather than 500ing on something that
      // would otherwise have rendered fine unresized.
    }
  }

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
