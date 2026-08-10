import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Reveal.tsx's scroll-triggered whileInView animations start every
    // section at opacity:0 and fade in on IntersectionObserver — a
    // screenshot taken right after `load` (no real user-paced scrolling
    // to trigger it) caught most of the homepage below the hero rendered
    // fully invisible. The app already has a `usePrefersReducedMotion`
    // escape hatch (Reveal.tsx renders a plain div immediately when it's
    // set) — forcing it here makes screenshots show real content instead
    // of a false "empty page" below the fold. `reducedMotion` isn't a
    // top-level PlaywrightTestOptions field in this installed version
    // (1.62.1) — it lives on the underlying BrowserContextOptions, reached
    // via `contextOptions`.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
