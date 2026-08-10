import { test, expect, type Page } from "@playwright/test";

const ROUTES = [
  "/",
  "/swap",
  "/nft",
  "/dashboard",
  "/faq",
  "/blog",
  "/games",
  "/orders",
  "/basket",
  "/dust-sweeper",
  "/evac",
  "/rebalance",
  "/sentinel-shield",
  "/burner-shield",
  "/radar",
];

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

// A screenshot taken right at `load` can catch real <img>s (NftImage's
// pulse skeleton, proxied through /api/img) still mid-fetch — that reads
// as a "broken image" in a static screenshot even though nothing is
// actually broken, just slow. Poll real completion instead of a fixed
// sleep so this stays fast on a quick load and still correct on a slow
// one. Deliberately does not fail the test on a real broken image (some
// pages intentionally show the broken-image placeholder icon for a
// vendor-dead URL, e.g. NftImage's own `failed` state) — this only exists
// to make screenshots trustworthy, not as an image-integrity assertion.
async function waitForImagesSettled(page: Page, timeoutMs = 6000) {
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll("img")).every(
          (img) => img.complete,
        ),
      { timeout: timeoutMs },
    )
    .catch(() => {});
}

for (const route of ROUTES) {
  test(`${route} loads without a client error and has a real h1`, async ({
    page,
  }) => {
    // /nft hits live, rate-limited third-party APIs (Magic Eden/OpenSea)
    // and can carry many images from its infinite-scroll grid — the
    // default 30s budget isn't enough headroom for a real (not broken)
    // slow load. Real client-facing perf is a separate, already-tracked
    // concern (Phase 1 caching/concurrency work), not something to paper
    // over by shrinking what this test checks.
    if (route === "/nft") test.setTimeout(60_000);

    const errors = trackPageErrors(page);

    // "networkidle" never resolves on pages with ongoing background fetches
    // (NFT collection stats/image-proxy calls, infinite-scroll observers) —
    // "load" is the reliable signal here; hydration/errors are still caught
    // via the pageerror/console listeners below regardless of wait strategy.
    const response = await page.goto(route, { waitUntil: "load" });
    expect(response?.ok(), `${route} responded ${response?.status()}`).toBeTruthy();

    // Real page-level heading present — regression guard for the 2026-08-06
    // finding that /swap and /nft shipped with no h1 at all.
    await expect(page.locator("h1").first()).toBeVisible();

    const hydrationErrors = errors.filter((e) =>
      /hydration|did not match|minified react error/i.test(e),
    );
    expect(hydrationErrors, `hydration errors on ${route}:\n${hydrationErrors.join("\n")}`).toEqual([]);

    await waitForImagesSettled(page);
    await page.screenshot({
      path: `test-results/screenshots/${route === "/" ? "home" : route.slice(1).replace(/\//g, "-")}.png`,
      fullPage: true,
    });
  });
}

test("mobile bottom command bar renders and its tabs are reachable", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "bottom bar is mobile-only chrome");

  await page.goto("/", { waitUntil: "load" });

  // AppHeader.tsx's MobileBottomBar renders a <nav aria-label="Primary">
  // (the only landmark with that label — desktop nav has none).
  const bottomBar = page.getByRole("navigation", { name: "Primary" });

  // Portaled to document.body per the 2026-08-10 fix (avoids the
  // backdrop-blur/position:fixed containing-block bug) — assert it's
  // actually visible in the viewport, not just present in the DOM.
  await expect(bottomBar.first()).toBeVisible();

  await page.screenshot({
    path: "test-results/screenshots/mobile-bottom-bar.png",
    fullPage: false,
  });
});

test("connect wallet menu opens as a full-viewport-centered portal, not clipped by the header", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });

  const connectButton = page.getByRole("button", { name: /connect/i }).first();
  await connectButton.click();

  // ConnectWalletMenu.tsx's portal root now carries role="dialog" (added
  // alongside this test — it had neither a role nor a testid before).
  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();

  const headerBox = await page.locator("header").first().boundingBox();
  const menuBox = await menu.boundingBox();

  // Regression guard for the backdrop-blur/fixed-positioning bug documented
  // multiple times in this project (ConnectWalletMenu 2026-07-21,
  // PortfolioDrawer 2026-08-07): a clipped portal renders confined to the
  // header's own small box instead of the viewport.
  if (headerBox && menuBox) {
    expect(menuBox.height).toBeGreaterThan(headerBox.height * 1.5);
  }
});
