export function toAtomicAmount(humanAmount: string, decimals: number): string {
  const [whole, frac = ""] = humanAmount.trim().split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  const digits = `${whole || "0"}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  return digits || "0";
}

// Always rounds UP (ceiling), never nearest/down — used for SOL/SUI amount
// display so a shown figure never understates what's actually needed (a
// buyer copying a rounded-down amount could underfund a transfer). No
// "server-only" restriction on this file — plain math, safe to import from
// both client components and server routes.
//
// Returns a STRING with exactly 2 decimal places, not a bare number — a
// real regression found live 2026-07-22: a round price like exactly 9 SUI
// rendered as the literal number `9` in JSX (no decimal point at all),
// inconsistent with every other price display in this app (which use
// `.toFixed(3)`) and reading as "decimals are missing" to a user comparing
// prices side by side. `.toFixed(2)` on the already-ceiling-rounded value
// guarantees two decimal places every time (`9` → `"9.00"`, `9.881` →
// `"9.89"`), same as any real currency display convention.
// Real bug found 2026-08-03 while writing this file's first test coverage:
// `Math.ceil(value * 100)` alone bumps an already-exact 2-decimal value up
// to the WRONG next cent for specific inputs — `9.55 * 100` evaluates to
// `955.0000000000001` in IEEE754 double precision, not exactly `955`, so
// `Math.ceil` rounded it up to 956 -> "9.56" instead of the correct "9.55".
// A buyer would have seen a price one cent higher than the real one for any
// amount landing on this kind of floating-point boundary. Fixed by rounding
// the intermediate cents value to 6 decimal places first — real currency
// amounts here never carry more than ~9 decimals of genuine precision (SOL/
// SUI's own atomic unit count), so this only strips floating-point noise
// (typically ~1e-13 relative magnitude), never a real digit — before
// applying the ceiling.
export function roundUpTo2Decimals(value: number): string {
  const cleanedCents = Math.round(value * 100 * 1e6) / 1e6;
  return (Math.ceil(cleanedCents) / 100).toFixed(2);
}
