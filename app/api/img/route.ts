import "server-only";
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
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_BYTES = 15 * 1024 * 1024; // generous for NFT art, still bounded
// 2026-08-05 (real user report, generalized fix — applies to every
// collection/vendor through this proxy, not just the one that surfaced it)
// — animated GIFs bypass Next.js's image optimizer entirely: confirmed live
// against this app's own deployed /_next/image endpoint, a w=256 resize
// request for a real animated GIF returned the exact untouched original
// byte count, zero compression. A collection whose listing images are
// multi-MB animated GIFs (confirmed real: Magic Eden's "Call of Saga" was
// 5MB each; two OTHER real collections — fomo_friends_oe, collectorcardclub
// — have no static alternative at all, so picking a different field can't
// help them) turns one 20-item grid into ~100MB of simultaneous unoptimized
// downloads — this is why "only 2 images load" for a user on a normal
// connection. A real fix (decode + re-encode just the first frame as a
// static image) needs a new dependency (sharp isn't installed) — deferred
// as bigger/riskier than a same-session fix. This is the safe default:
// animated GIFs over a much stricter cap are rejected outright (NftImage's
// existing broken-image fallback state already handles a failed image
// gracefully) instead of passed through at whatever size the source
// happens to be. Small/legitimate animated GIFs stay completely unaffected.
const MAX_ANIMATED_BYTES = 800 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";

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

  // See MAX_ANIMATED_BYTES's comment above — a stricter cap for animated
  // GIFs specifically, since next/image can't shrink them like every other
  // format here.
  const isAnimatedGif = contentType.toLowerCase() === "image/gif";
  const effectiveMaxBytes = isAnimatedGif ? MAX_ANIMATED_BYTES : MAX_BYTES;
  const tooLargeMessage = isAnimatedGif ? "Animated image too large" : "Image too large";

  const contentLength = upstream.headers.get("content-length");
  if (contentLength && Number(contentLength) > effectiveMaxBytes) {
    return new Response(tooLargeMessage, { status: 413 });
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > effectiveMaxBytes) {
    return new Response(tooLargeMessage, { status: 413 });
  }

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
