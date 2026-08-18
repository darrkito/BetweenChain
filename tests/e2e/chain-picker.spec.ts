import { test, expect, type Locator, type Page } from "@playwright/test";

// Regression coverage for the 2026-08-18 chain-expansion work
// (lib/chains/swapOnlyEvmChains.ts + Sui swap support) — confirms the new
// chains actually reach the token-select modal's UI, not just
// /api/tokens/chains's raw JSON (already verified live against a preview
// deploy during that change, but that only proved the API — this proves
// the picker wiring: chain search, chain selection, and the resulting
// token list render correctly end to end).
async function openBuyTokenModal(page: Page): Promise<Locator> {
  await page.goto("/swap", { waitUntil: "load" });
  // Both Sell and Buy pills can briefly read "Select token" before
  // SwapPageClient's fetchNativeToken effect resolves the Sell side's
  // default (native SOL) — scope to the "Buy" card specifically via its
  // own <p>Buy</p> label's parent container (SwapPanel.tsx) rather than
  // relying on pill order.
  const buyCard = page.getByText("Buy", { exact: true }).locator("..");
  await buyCard.getByRole("button", { name: "Select token" }).click();
  await expect(page.getByPlaceholder("Search chains")).toBeVisible();
  return buyCard;
}

test("Sui appears in the chain picker and its native token is selectable", async ({ page }) => {
  const buyCard = await openBuyTokenModal(page);

  await page.getByPlaceholder("Search chains").fill("Sui");
  // ChainRow's button accessible name is "{icon alt} {label}" — TokenIcon's
  // alt echoes the chain's own displayName, so this is "Sui Sui", not a
  // bare "Sui" — not using exact:true, a substring match is what's real.
  const suiChainButton = page.getByRole("button", { name: "Sui" });
  await expect(suiChainButton).toBeVisible();
  await suiChainButton.click();

  // getTokenListForChain's Sui special-case (lib/chains/tokenList.ts)
  // returns exactly one entry: native SUI.
  await expect(page.getByText("Sui tokens")).toBeVisible();
  const suiTokenButton = page.getByRole("button", { name: /SUI/ });
  await expect(suiTokenButton).toBeVisible();

  await suiTokenButton.click();

  // Modal closes and the Buy pill now shows the picked token instead of
  // the "Select token" placeholder.
  await expect(page.getByPlaceholder("Search chains")).toBeHidden();
  await expect(buyCard.getByRole("button", { name: /SUI/ })).toBeVisible();
});

test("newly-added EVM chains (BNB, Linea) appear in the chain picker", async ({ page }) => {
  await openBuyTokenModal(page);

  for (const chainName of ["BNB", "Linea"]) {
    await page.getByPlaceholder("Search chains").fill(chainName);
    await expect(page.getByRole("button", { name: chainName })).toBeVisible();
  }
});
