// Quick full-page desktop+mobile screenshots of any URL (local dev server
// or production) — for a fast visual sanity check when no interactive
// browser tool is available this session (see AGENTS.md's "Verification
// tooling" note). Not part of the real Playwright E2E suite (tests/e2e/) —
// that's for assertions; this is just for eyeballing a diff before/after.
// Usage: node scripts/visual-check.mjs [url]  (defaults to production).
import { chromium } from "playwright";

const url = process.argv[2] ?? "https://blockchains.click";
const outDir = "/tmp/visual-check";

const browser = await chromium.launch();

for (const [label, viewport] of Object.entries({
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
})) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${outDir}/${label}-full.png`, fullPage: true });
  await context.close();
  console.log(`saved ${label}-full.png`);
}

await browser.close();
