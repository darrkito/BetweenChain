export function toAtomicAmount(humanAmount: string, decimals: number): string {
  const [whole, frac = ""] = humanAmount.trim().split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  const digits = `${whole || "0"}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  return digits || "0";
}

// Always rounds UP (ceiling), never nearest/down — used for SOL/SUI/ETH
// amount display so a shown figure never understates what's actually
// needed (a buyer copying a rounded-down amount could underfund a
// transfer). No "server-only" restriction on this file — plain math, safe
// to import from both client components and server routes.
//
// Returns a STRING with exactly 3 decimal places, not a bare number — a
// real regression found live 2026-07-22: a round price like exactly 9 SUI
// rendered as the literal number `9` in JSX (no decimal point at all),
// inconsistent with every other price display in this app and reading as
// "decimals are missing" to a user comparing prices side by side.
// `.toFixed(3)` on the already-ceiling-rounded value guarantees three
// decimal places every time (`9` → `"9.000"`, `9.8811` → `"9.882"`), same
// as any real currency display convention. 3 decimals (not 2) standardized
// across every NFT price display 2026-08-05 — 2 decimals had crept in on
// some call sites (this function) while others used `.toFixed(3)` directly,
// showing genuinely different precision for the same kind of number
// depending which component rendered it; a real user-reported inconsistency.
// Real bug found 2026-08-03 while writing this file's first test coverage:
// `Math.ceil(value * 1000)` alone bumps an already-exact 3-decimal value up
// to the WRONG next thousandth for specific inputs — floating-point
// multiplication can land a hair above the exact value it should represent,
// so `Math.ceil` rounds up to the next unit instead of keeping the exact
// one. Fixed by rounding the intermediate thousandths value to 6 decimal
// places first — real currency amounts here never carry more than ~9
// decimals of genuine precision (SOL/SUI's own atomic unit count), so this
// only strips floating-point noise (typically ~1e-13 relative magnitude),
// never a real digit — before applying the ceiling.
export function roundUpTo3Decimals(value: number): string {
  const cleanedThousandths = Math.round(value * 1000 * 1e6) / 1e6;
  return (Math.ceil(cleanedThousandths) / 1000).toFixed(3);
}
