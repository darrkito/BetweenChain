# Route Quality & Rebalancing Features — research + plan (2026-08-09)

Four pitches researched live before ranking anything: Route Auditor, Self-Heal Bridge
Rescue, MEV Shield, Portfolio Rebalancer. Two of the four make specific technical claims
that do NOT hold up against this app's actual bridging engine (Relay) or real wallet
constraints — documented plainly below, not glossed over. Ranked easiest → hardest.

## Ranking: easiest → hardest

| # | Feature | Difficulty | Why |
|---|---------|-----------|-----|
| 1 | Route Auditor | **Trivial–Easy** | Real data already fetched from both engines, currently discarded — pure UI |
| 2 | Stall Transparency Panel (rescoped "Self-Heal") | **Easy** | Reuses an existing internal function; original pitch's core mechanism confirmed not real |
| 3 | MEV Shield — Solana only | **Medium** | Real, live-verified Jito infrastructure; EVM side confirmed not cleanly buildable |
| 4 | Portfolio Rebalancer | **Medium–Large** | Real, but "atomic single signature" claim overstated — genuine near-equivalent exists |

---

## 1. Route Auditor — trivial–easy — ✅ SHIPPED 2026-08-09

`lib/chains/routeAudit.ts` + `app/api/quote/preview/route.ts` + `app/components/SwapPanel.tsx`'s
"Route details" expandable panel. Verified live end-to-end via a real dev-server request
before shipping: a real SOL→ETH(Base) preview returned `priceImpactPct: -0.89`,
`timeEstimateSeconds: 3`, `dexLabels: ["kyberswap"]` — all real, previously-discarded
fields from Relay's/Jupiter's existing quote responses. No synthetic score, as planned.

### Real infra found (live-verified via direct API calls, not docs)
Relay's `/quote` response — the SAME call this app already makes for every cross-chain
swap — already returns, completely unused today:
- `details.totalImpact` / `swapImpact` / `expandedPriceImpact` — real, itemized price
  impact broken down by swap/execution/relay/app/sponsored components.
- `details.timeEstimate` — a real integer seconds field (confirmed: `3` on a live
  SOL→ETH quote).
- `details.route.origin.router` / `.destination.router` — which DEX actually filled
  each leg (confirmed live: `"relay"` origin, `"0x"` — 0x Protocol — destination).
- `details.slippageTolerance` — real origin/destination breakdown.

Jupiter's `/quote` (already called for the Solana leg) already returns:
- `priceImpactPct` — real, precise.
- `routePlan` — which AMM/pool filled the trade (confirmed live: `"HumidiFi"`).
- `otherAmountThreshold` — the real on-chain minimum-output guarantee.

### What's fabricated in the pitch — do not build
- **"Intent Solver Buffer: 14.8 ETH available on Base"** — Relay's public API exposes
  no such field. A solver's actual inventory/liquidity buffer is proprietary,
  not queryable. Do not claim to show this.
- **"Confidence Score: 99.4%"** — no such metric exists from either engine. A fabricated
  single number implies false precision. If a summary indicator is wanted, derive it
  transparently from the REAL fields above (e.g., a plain-language bucket like "Low
  impact, ~3s" vs "High impact, review before signing" based on real thresholds on
  `totalImpact.percent` and `timeEstimate`) — never a synthetic score with no stated
  methodology.

### Implementation
Add an expandable "Route details" panel to the swap review step, rendering fields
already present in the quote response object this app already holds in state — no new
API calls, no new engine capability. Both Jupiter and Relay's raw quote objects are
already passed through `swap_quotes.jupiter_route`/`relay_route` — the data is one
property-access away.

---

## 2. Stall Transparency Panel (rescoped from "Self-Heal Bridge Rescue") — easy — ✅ SHIPPED 2026-08-09

`app/api/bridge/confirm/route.ts` now returns Relay's real `relayStatus` alongside the
existing collapsed status (previously discarded). Both polling loops that consume it —
`lib/client/executeSwapFlow.ts` (Dust Sweeper/Baskets/Evac Engine/ClickPay) AND
`app/swap/SwapPageClient.tsx`'s own separate loop (the highest-traffic page, kept
deliberately unrefactored per that file's own doc comment — mirrored the fix instead of
sharing code) — now surface real status text once a swap has been pending long enough to
feel stalled, and give `refund` a distinct, honest message instead of a generic failure.

### Why the original pitch isn't real
Live-checked Relay's own refunds documentation directly: refunds/completion for a
stalled or failed fill are **entirely handled by Relay's own solver/relayer network**.
There is no user-triggerable Merkle-proof claim or manual redemption mechanism exposed
anywhere in their public docs or API — that pattern belongs to older lock-and-mint
bridges (e.g. classic Wormhole token bridge's VAA redemption), not Relay's solver-based
fast-bridge model, which is what this app actually uses. **Building a fake "Self-Heal"
button that claims to submit a proof would be dishonest — there is nothing real for it
to do.**

### What's genuinely buildable
This app already has `getRelayIntentStatus(requestId)` (`lib/chains/relay.ts`), polled
server-side in `/api/bridge/confirm` — real Relay intent statuses:
`pending | success | failure | fallback | received | refund | unknown`. Currently the
user-facing UI just shows a generic "confirming…" spinner during this window. A real,
honest improvement: surface the ACTUAL status live once a swap has been pending beyond
a threshold (e.g. 15s) — "Relay is refunding your deposit" (status `refund`) is a
completely different, much less alarming message than a silent spinner, and is real
information this app already has and currently throws away.

### Implementation
Client-side polling of a new lightweight public status-check endpoint (wrapping the
existing `getRelayIntentStatus`) once `leg2_pending` has been showing for >15s, with
plain-language copy per real status value. No new backend capability — reuses an
existing internal function, adds a route + polling that isn't wired up today.

---

## 3. MEV Shield — Solana only, medium — ✅ SHIPPED 2026-08-09

`lib/client/jito.ts` + a "Route via Jito" checkbox in `SwapPanel.tsx` (Solana-origin
only). No tip instruction injected in v1 (Jito confirmed live: tips are optional for
`sendTransaction`, only required for `sendBundle`) — real, scoped follow-up. EVM/
Flashbots confirmed NOT built, per the research above (standard wallets don't expose
`eth_signTransaction`). See `SECURITY.md`'s entry: no new custody, same signature just
broadcast somewhere private.

### Real infra found (live-verified)
- **Jito Block Engine** (`mainnet.block-engine.jito.wtf`) — confirmed live: both
  `sendBundle` and `sendTransaction` JSON-RPC methods respond to unauthenticated
  requests with real validation errors (not 401/403) — no API key, no partnership
  needed. Real tip accounts confirmed via Jito's own docs (8 designated accounts,
  1,000 lamport minimum tip, ~70/30 priority-fee/tip split recommended for
  `sendTransaction`).
- This app's EXISTING Solana signing pattern already produces exactly what's needed:
  `signTransaction` (wallet-adapter) returns a signed-but-not-yet-broadcast
  `VersionedTransaction`, which the app currently hands to
  `connection.sendRawTransaction()`. Swapping that one call for a POST to Jito's
  `sendTransaction` endpoint (plus a tip instruction added to the transaction before
  signing) is a real, contained change — no new custody, no new signing model.

### Why the EVM side is NOT cleanly buildable as pitched
Live-researched: Flashbots Protect integration works via `eth_sendRawTransaction` —
it needs the RAW SIGNED transaction bytes. Standard injected wallets (MetaMask and
most others) do **not** expose `eth_signTransaction` via their provider API
(a well-known, deliberate wallet-security restriction — the same "sign here, broadcast
elsewhere" capability that makes MEV protection possible is also a phishing/replay
vector, so wallets lock it down). The commonly-documented Flashbots integration path is
the USER manually adding Flashbots Protect as their wallet's network RPC — a wallet-level
setting, not something this app can silently route per-transaction the way the pitch's
mockup implies. Forcing it via `wallet_addEthereumChain`/`wallet_switchEthereumChain`
would mean temporarily rewriting the user's network config for one swap — poor,
confusing UX, and not guaranteed to work across wallets.

**Recommendation**: ship real Jito-based MEV protection for Solana swaps only. For EVM,
ship honest guidance (a real "protect this swap" info panel linking to Flashbots
Protect's setup instructions) rather than a fake one-click toggle that can't actually
reroute the transaction.

### Implementation
1. New helper (`lib/solana/jito.ts`): builds/appends a tip instruction to a Solana
   transaction, submits the signed transaction to Jito's `sendTransaction` endpoint
   instead of the default RPC.
2. Opt-in checkbox on the swap page for Solana-origin swaps ("Route via Jito — avoid
   public mempool"), same interaction pattern as the existing gas-top-up checkbox.
3. Real disclosure: private routing reduces sandwich-bot visibility; it does not
   guarantee zero MEV (a swap's own on-chain slippage/minOut check already reverts an
   unacceptable fill regardless of routing — Jito's real value is avoiding wasted gas on
   a doomed public-mempool attempt and avoiding successful-but-worse-than-expected
   sandwiches within slippage tolerance, not a "$0.00 guaranteed" claim).

---

## 4. Portfolio Rebalancer — medium–large — ✅ SHIPPED 2026-08-09 (v1, sequential — not relayer-batched)

`lib/rebalance/computeDeltas.ts` + `app/rebalance/RebalanceClient.tsx`. Scans real
Solana + EVM balances (Solana priced via `/api/tokens/mint-prices`, same as Dust
Sweeper), lets the user set target percentages (defaulting to current weight),
computes real USD deltas, and executes the sell→buy sequence via `executeSwapFlow` —
one signature per leg, same guided-sequential-swap model as Evac Engine/Dust Sweeper.

### Scope decision made at implementation time (not in the original research above)
The relayer-batched "1 signature" version described below under "What's overstated in
the pitch" is real and buildable (this app already has the exact SPL-delegate +
relayer pattern from Trigger Orders/OmniDust Vacuum) but is a genuinely bigger lift —
deferred as a scoped follow-up rather than blocking v1. v1 uses the SAME execution
model as Evac Engine/Dust Sweeper instead: each sell/buy leg is its own ordinary swap,
signed individually. `lib/rebalance/computeDeltas.ts`'s `splitSellAcrossBuys` reuses
`lib/baskets/split.ts`'s exact-sum BigInt `splitAmount` to proportionally divide each
over-allocated holding's excess across every under-allocated buy target by deficit
share — the same math, applied to N sells × M buys instead of 1 deposit × N
allocations. Sui excluded (no Sui swap execution path exists anywhere in this app).

### Real infra to reuse
Generalizes two things this app has already built:
- Balance scanning across chains (Dust Sweeper's/Evac Engine's Solana + EVM balance
  detection, minus any dust threshold — a full "what do I hold and where" scan).
- Delta/split math (`lib/baskets/split.ts`'s BigInt-precise allocation pattern extends
  naturally to "current % → target %" delta calculation instead of "100% of a new
  deposit → N allocations").
- Execution (`executeSwapFlow`, proven across Baskets/Dust Sweeper/Evac Engine).

### What's overstated in the pitch — scope honestly
**"2 Atomic Cross-Chain Intent Permits" / "SIGN & REBALANCE" as one action** — there is
no mechanism for atomically executing multiple independent swaps (sell SOL, buy ETH,
buy USDC on Sui) across different DEXs and bridges in a single on-chain transaction —
this has been confirmed false for every "batch swap" pitch this session (Baskets, Dust
Sweeper). What IS real and achievable: reusing the SAME bounded SPL-delegate +
relayer pattern built twice already (Trigger Orders, OmniDust Vacuum) — the user signs
ONE delegate approval covering the tokens being SOLD to fund the rebalance, and the
relayer executes the actual sell/buy sequence. Genuinely "1 signature," just not
"1 atomic transaction" — an important, honest distinction to keep in the UI copy.

Sui is out of scope for v1 (same reason as every other Sui-execution gap this app has —
no Sui swap execution path exists anywhere in this codebase yet); the pitch's own
"25% USDC (Sui)" example would need to be scoped to Solana/EVM targets only.

### Implementation
1. Scan real current balances across connected wallets (reuse Evac Engine's scanner).
2. User sets target percentages across a Solana/EVM asset list; compute real deltas in
   atomic units.
3. For over-allocated assets: same delegate-approval batch pattern as OmniDust
   Vacuum, sized to the exact sell amount needed (not a buffer-based estimate — the
   delta is a known quantity from step 1/2, same reasoning as dust amounts).
4. Relayer executes: sell over-allocated assets, buy under-allocated ones, deliver to
   the user's own wallets — reusing `executeSwapFlow`'s server-side equivalent pattern
   already proven in `lib/relayer/deliverDustSweep.ts`.
5. Delivered on the same daily cron as Trigger Orders/OmniDust Vacuum (no second
   `crons` entry — Hobby-plan lesson from earlier this session stays load-bearing).

## Verification (all parts)
Same standing discipline: live-verify every claim before writing code against it
(confirmed for all 4 above), `tsc`/`lint`/`test`/`build` clean before each commit, a
blog post per shipped feature, and Vercel deployment confirmation after each push.
