# Build state

Update this file at the end of any session that changes the architecture, fixes a
non-obvious bug, or makes a scope decision — keep entries dated, newest first, and don't
delete history (superseded entries stay for context, just note what replaced them).

---

## 2026-08-03h — Solana NFT main page now shows ranked top collections (floor + volume), matching Sui/Ethereum

**The gap**: `app/nft/page.tsx` renders the same `NftCollectionsGrid` for every chain family, and that
component already sorts/displays floor+volume generically — the bug was purely in the Solana data
source. `browseMagicEdenCollections` called the documented `${MAGICEDEN_API}/collections` endpoint,
which (confirmed live) has **no sort/rank parameter at all** — plain pagination in ME's internal storage
order, so the page showed junk/test entries ("The Bullpen TEST") ahead of real collections, with every
Floor/Volume cell blank (that endpoint returns no stats fields either). OpenSea's browse already sorts
`order_by=seven_day_volume` + per-collection `/stats` enrichment, and Tradeport's already
`order_by:{volume:desc}` — Solana was the only chain family without either.

**Fix**: switched `browseMagicEdenCollections` (`lib/nft/magiceden.ts`) to
`https://stats-mainnet.magiceden.io/collection_stats/search/solana?window=1d&sort=volume&direction=desc`
— confirmed live 2026-08-03, no API key required, returns floor price + 24h volume + listed/total supply
already in native SOL units (not lamports). This is undocumented but is the exact endpoint
magiceden.io's own site uses for its home page "Popular collections" table — same category of
"real site behavior over stale docs" pattern this codebase has hit before with ME (see 2026-08-03g).
`collectionSymbol` from this endpoint is the same `symbol` used everywhere else (getMagicEdenCollection,
getMagicEdenListings, buy_now) — verified live against a real result (`claynosaurz`) that
listings/collection-detail routing still resolves correctly.

**Docs cross-check** (per user request, `docs.magiceden.io/reference/solana-overview` +
`/recipes`): found the *officially documented* ranking endpoint,
`GET /v2/marketplace/popular_collections?timeRange=1d` (no key required per docs) — tested live
with and without a real API key, **always returns `[]`** regardless of `timeRange`. Confirms this
endpoint is dead/deprecated on Magic Eden's backend despite being documented, which is why the
undocumented stats-mainnet host was used instead (it actually returns real data). Also verified
`GET /instructions/buy_now`'s documented params against the 2026-08-03g fix: docs list
`auctionHouseAddress` as *optional* ("defaults if omitted") and `sellerExpiry` as *required* — live
behavior contradicts both: omitting `auctionHouseAddress` reliably 400s ("invalid auction house",
the exact bug fixed in 2026-08-03g), and the endpoint returns `200 OK` with a real signed tx even
without `sellerExpiry`. Treat ME's docs as directionally useful but not authoritative — verify
against live behavior before trusting a documented default/requirement.

## 2026-08-03g — Magic Eden buy-instructions key confirmed active; real code bug found and fixed; eslint noise cleared

**Magic Eden key status, re-verified live against `instructions/buy_now`:**
- No auth → `401`. Garbage key → `401`. Real key (unchanged since 2026-08-03) → `400
  "invalid auction house"`. That's a clearly distinguishable, real auth pass — the
  earlier "still 401, identical to garbage key" conclusion (logged 2026-08-03) is now
  stale; the key activated at some point between then and now (Magic Eden gave no
  activation notification, so exact timing unknown).
- The residual `400` was **not** an auth/approval problem — it was a real code bug.
  `getMagicEdenBuyInstructions` (`lib/nft/magiceden.ts`) never sent `auctionHouseAddress`,
  a required param the endpoint silently needs. Added `auctionHouse` to
  `RawMagicEdenListing` (was already present on every listing response, just unused) and
  wired it into the request. Confirmed live with a real `okay_bears` listing: `200 OK`
  with a real signed Solana tx buffer back.
- `MAGICEDEN_API_KEY` was already present on Vercel (production + preview) from the
  2026-08-03 env-vars pass — no new deploy config needed, just the code fix shipping
  through the normal pipeline.
- Buy flow is now unblocked end-to-end for Magic Eden/Solana at the instruction-building
  level. Still not signed with a real wallet+funds yet (Phase 3.2 in `PLAN.md`'s
  improvement plan) — that remains the actual "done" bar.

**Lint cleanup**: `npm run lint` was reporting 154 errors/32 warnings, 100% of them on a
single minified line inside `supabase/.temp/start-secrets/.../main/index.ts` — a
generated/vendored file from the local Supabase CLI's Edge Runtime scratch dir, gitignored
but not eslint-ignored. Added `supabase/.temp/**` and `supabase/.branches/**` to
`eslint.config.mjs`'s ignores. `npm run lint` now exits clean (zero output) against real
project source, which had zero actual lint issues.

## 2026-08-03f — Real OpenSea account key replaces the expiring agent-tier one

User obtained a real account-tier OpenSea key. Live-verified before wiring anywhere:
120 reads/min (double the old agent-tier key's 60), and — the part that actually
matters — real write access to `/listings/fulfillment_data`, the buy-execution
endpoint the NFT purchase flow depends on (the old key never had this tested; browse/
listings worked on both keys). No expiry concern with this tier, closing the
2026-08-19 hard-expiry risk the old key carried. Updated in both places: `.env.local`
(local dev) and Vercel's production env vars (via API, then a redeploy to actually
pick it up — env var changes don't retroactively apply to an already-built
deployment). Confirmed live against production afterward.

---

## 2026-08-03e — First real production deployment: GitHub + Vercel + hosted Supabase, two live bugs found and fixed

The app went live for the first time this session — `github.com/darrkito/BetweenChain` →
`betweenchain.vercel.app`, backed by a real hosted Supabase project (all 12 migrations
applied) instead of the local Docker instance. Full checklist: initial git commit (this
repo had **zero commits ever** before this — confirmed via `git log`), GitHub push,
Vercel project creation (via the dashboard, user-driven — account creation and OAuth
consent can't be automated), all 20 production env vars set via Vercel's API (mapped to
the exact names the app code reads, not blindly copied — the new hosted Supabase project
uses newer `sb_publishable_`/`sb_secret_` format keys plus a still-available legacy
JWT-format anon/service_role pair; pulled the real `jwt_secret` via the Management API's
`/postgrest` config endpoint since this app mints its own JWTs against a shared secret,
not Supabase's own auth system).

**Real bug #1, found live via user report**: the Connect Wallet button rendered unstyled
and wallet lists (Solana/EVM/Sui) never populated in production. Root cause: the
dark-mode pre-hydration script (`app/layout.tsx`'s `THEME_INIT_SCRIPT`, added earlier
this session) sets `data-theme` on `<html>` before React hydrates — intentional, that's
how it prevents a flash of the wrong theme — but server-rendered HTML has no such
attribute, so React saw a mismatch on `<html>` itself and gave up hydrating the whole
tree. Fixed with `suppressHydrationWarning` on `<html>`, the standard documented pattern
for this exact technique. This bug was invisible to every check made earlier in the
session (curl-based HTTP/HTML checks can't detect a client-side hydration failure) —
only surfaced once the user actually opened it in a real browser with the console open.

**Real bug #2, found live via user report right after fixing #1**: header buttons
appeared "stacked on top of each other," NFTs nav link seemed to not show. Root cause:
nav/wordmark text had no `whitespace-nowrap` — on a squeezed row, flexbox shrinks a
flex item's width but never stops its own text from wrapping unless told to, so multiple
now-multi-line children of differing heights next to each other (all with
`items-center`) reads as overlapping/stacked buttons. Fixed with `whitespace-nowrap`
throughout `AppHeader.tsx`, `flex-wrap`+`gap-y-2` on the header itself as a genuine
overflow safety net, and shortened "Token Swap"→"Swap" below `sm`, matching the
wordmark/wallet-button shortening already next to it.

**Infrastructure discovery**: Vercel's dashboard-driven project import auto-created a
**separate, disconnected private GitHub repo** (`darrkito/between_chain`, repoId
1321897971) rather than linking to the real `darrkito/BetweenChain` repo (repoId
1321894527) code actually lives in and gets pushed to — confirmed via mismatched repo
IDs and a stale deployed commit sha that never advanced despite real pushes. Vercel's
REST API has no documented way to re-link a project's git connection (dashboard-only).
Worked around it two ways: (1) manual `vercel deploy --prod --token=...` from local
files for the two live-bug hotfixes above (bypasses git entirely), and (2) added
`.github/workflows/deploy.yml` — a GitHub Actions workflow that runs the same CLI
command on every push to `main`, fully replicating "push → auto-deploy" without
depending on Vercel's own GitHub App integration. Needed one manual step from the user
(adding `VERCEL_TOKEN` as a GitHub Actions secret — same class of unavoidable
account/credential step as everything else this session). `.vercel/project.json`
(org/project IDs only, no secrets) is deliberately committed — normally gitignored, but
CI needs it to know which Vercel project to deploy to without an interactive
`vercel link`.

**Also discovered**: the Vercel personal access token used throughout this setup is
team-scoped, not user-scoped — it works fine for every project/env/deployment REST API
call, but 404s (`"User not found"`) against `/v2/user` and the Vercel CLI's own
`whoami`/`link` commands, which specifically need a user-identity token. Worked around
by hand-writing `.vercel/project.json` directly instead of running `vercel link`.

---

## 2026-08-03d — Upstash Redis provisioned; rate-limiting now genuinely shared/persistent (Phase 1.1 closed)

The one Phase 1 item that needed the user's own action (a free Upstash account/DB —
`lib/rate-limit.ts` already supported it, just had no credentials) is done. User created
the account and added `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` to `.env.local`.

Verified live, not just "env vars are set so it should work": restarted the dev server to
pick up the new values, hit `/api/auth/session`, then queried Upstash's own REST API
directly (`GET {url}/keys/sbc%3Aratelimit%2A`) and confirmed a real
`sbc:ratelimit:::1:auth:session:...` key existed in the actual external database — not
just a local assumption. Then did the test that actually matters: killed the dev server
entirely (simulating a redeploy/crash) mid-window, restarted it fresh, made another
request, and confirmed the rate-limit state was still there in Upstash — proving it's
no longer per-process. Before this fix, restarting would have silently wiped the
in-memory `Map` and reset every rate limit to zero; now the state was never in the Node
process at all, so a restart can't lose it. This closes the concrete risk flagged in
Phase 1's original audit: an attacker distributed across concurrent
serverless/redeployed instances could no longer get N× the intended limit on
auth/quote/swap/referral-redeem routes.

Also re-tested the Magic Eden buy-instructions key (`MAGICEDEN_API_KEY`) now that the
24-48h activation window ME quoted has fully passed — still 401, identical to a garbage
key, no change from the last check. Ruled out "just needs more time"; updated
`lib/nft/magiceden.ts`/`.env.local`'s comments to point at the Airtable approval form as
the actual next step (needs the user's own submission, not something to keep re-checking).

**Both loose ends from Phase 1 are now resolved/current-state-confirmed.** Nothing else
queued from the improvement plan — Phase 3 (mystery box + NFT buy-flow completion) was
explicitly deferred/skipped by the user (mystery box needs a product decision; NFT
buy-flow completion needs real signed transactions with real funds, live testing only
the user can do).

---

## 2026-08-03c — Deep improvement pass, Phase 2 (frontend/mobile UX), part 2: swap flow UX overhaul — Phase 2 now fully complete

Finished Phase 2 (part 1 was the responsive layout pass + Sui wallet fix, previous
entry) with the swap flow itself — `app/page.tsx` and `SwapPanel.tsx` had accumulated
real UX debt: no review step before signing, slippage hardcoded with no UI control, a
raw `<pre>{JSON.stringify(...)}</pre>` debug dump shipped to real users, no wallet
balance/Max shortcut, no inline validation, and a flip button that silently no-op'd.

**Added:**
- **Review step** — clicking the main button now opens a summary (sell/buy amounts,
  slippage, destination address for cross-chain) before the wallet-signature prompt,
  with copy explicitly clarifying the real quote is still fetched fresh on confirm (this
  is a UX review of what was typed, not a second binding quote).
- **Slippage control** (`SlippageControl.tsx`) — 0.5/1/3% presets + custom input,
  clamped 0.01%-50%. Was hardcoded to 100bps in the `/api/quote` request body with zero
  UI control before this.
- **`SwapStepper.tsx`** replaces the single overwritten-in-place status line — a real
  multi-stage progress indicator (Quote → Sign → Confirm → [Bridge if cross-chain] →
  Done), with the specific failed stage highlighted on error rather than a generic
  banner. Required tracking flow phase in a local variable inside `runSwap()`, not the
  `step` React state directly — state read inside an async function's own closure
  doesn't see later `setStep()` calls made within that same execution (classic stale-
  closure gotcha, not obvious from a first read of the old code).
- **Balance + "Max" button** (`lib/client/useSolanaBalance.ts`) — Solana only (native
  SOL + SPL tokens); an EVM equivalent needs a new balance-read capability exposed
  through `EvmWalletProvider.tsx`'s context (currently action-only), not built in this
  pass, documented as a known follow-up rather than silently skipped. Native SOL's Max
  reserves 0.01 SOL for fees rather than offering the literal full balance (which would
  guarantee the tx itself fails on "insufficient funds for gas").
- **Inline destination-address validation** — a bad cross-chain address now flags red
  with a message directly under the field (chain-aware: tries `PublicKey` parsing for a
  Solana destination, `isPlausibleEvmAddress` — the EIP-55-checksummed one from Phase
  1's hardening — for an EVM one) instead of only surfacing as a generic error after the
  flow had already started.
- **Flip button feedback** — silently no-op'd before when flipping would produce an
  invalid Buy-side pick; now sets a real message explaining why nothing happened.
- **Removed the debug `<pre>{JSON.stringify(bridgeSteps, null, 2)}</pre>`** — was a
  raw dump of Relay's internal step objects shipped straight to end users; the
  `bridgeSteps` state itself was also removed since nothing else read it.

Verified: `tsc --noEmit` and `eslint` clean on every touched file, `npm test` still 71/71
(no regressions in the existing Vitest suite), page loads with zero console/HTML error
markers against the running dev server, dev server logs show clean compiles and the
default-SOL-sell-token fetch still working. Same caveat as part 1: no browser tool was
connected this session, so the review-step/stepper/slippage-control UI is logic-verified
(types, lint, no runtime errors) but not eyeballed — worth a manual click-through before
calling this fully production-ready, especially the multi-minute cross-chain flow's
stepper transitions, which can't be exercised without real bridging funds anyway.

**Phase 2 (frontend/mobile UX) is now complete** — responsive layout, PWA basics, swap
UX overhaul, mobile wallet messaging, the Sui wallet fix, and the dark mode toggle all
shipped across this and the previous entry. Moving to Phase 3 (new features: mystery box
+ NFT buy flow completion) next, per the improvement plan, no stop requested between
phases.

---

## 2026-08-03b — Deep improvement pass, Phase 2 (frontend/mobile UX), part 1: responsive layout pass + a real dead-code wallet bug

Continuing the phased plan from Phase 1 (backend foundation, previous entry) straight
into Phase 2 — no stopping point requested between phases. Frontend/mobile audit found
**zero** device-detection code anywhere and **zero** responsive breakpoints outside the
NFT browse surfaces; the swap flow and every wallet-connect component were 100%
desktop-first.

**Real bug found and fixed: Sui wallet connection didn't work from the header at all.**
`SuiConnectPicker.tsx` already existed, worked, and was even already wired into
`NftBuyModalSui.tsx` — but `ConnectWalletMenu.tsx` (the actual "Connect Wallet" button
in the header, present on every page) rendered a static `"Sui wallet support isn't
built yet"` note instead of using it. This meant the one chain with a genuinely
mobile-compatible connect path (Slush's web-wallet flow needs no browser extension at
all, unlike Solana/EVM which both assume one) was sitting completely unused. Fixed by
wiring `useCurrentAccount`/`useDisconnectWallet`/`<SuiConnectPicker />` into the Sui
section, mirroring the exact pattern `NftBuyModalSui.tsx` already used. `anyConnected`
(drives the header button's "Wallets connected" state) now also checks Sui.

**Responsive layout fixes, all confirmed-broken via the audit's code read, not
guessed:**
- `TokenSelectModal.tsx` — the chain-picker sidebar was a hardcoded `w-56` (224px)
  sitting *beside* the token list at every viewport width; on a ~360-390px phone, after
  the modal's own padding, that left ~100px for the actual token list. Now stacks above
  the list (full width, height-capped, scrolls internally) below `md`, unchanged at
  `md:` and up. Needed `min-h-0` on the flex-1 content column too (a real flexbox
  gotcha: without it, a flex child in a column context won't actually let its own
  `overflow-y-auto` engage under a height cap).
- `ConnectWalletMenu.tsx`, `NftBuyModal.tsx`, `NftBuyModalSui.tsx` — none of these
  modals had a `max-height`/`overflow-y-auto` guard (unlike `TokenSelectModal`, which
  already had one) — would silently overflow a short mobile viewport. All three now
  cap at `85vh` with internal scroll.
- `AppHeader.tsx` — logo + 2 nav links + wallet button was a single unwrapped row with
  no mobile treatment at all. Below `sm`: wordmark shrinks to initials ("SBC"), nav link
  padding tightens, wallet button text shortens ("Wallets connected" → "Connected").
  `sm:` and up is pixel-identical to before.
- NFT detail page (`app/nft/[vendor]/[slug]/page.tsx`) — the trait filter sidebar was
  `hidden md:flex` with **no mobile equivalent at all**: below 768px, filters were
  completely unreachable, not just hidden-behind-a-toggle. Added a `md:hidden` "Filters"
  button (with an active-filter-count badge) next to the search bar that opens a
  bottom-sheet overlay containing the exact same `<NftTraitFilters>` component the
  desktop sidebar uses — same state, same options, different container.
- Same page: the item grid capped at `sm:grid-cols-3` with no `lg:`/`xl:` step-up,
  unlike the collections grid (already `lg:grid-cols-4`) — added `lg:grid-cols-4` for
  consistency, better wide-desktop use.
- Same page: the disabled "Coming soon" buy button explained itself via a native
  `title` tooltip only — tooltips never fire on touch devices, so mobile users got zero
  explanation for a disabled button. Added an always-visible short caption below the
  button (kept `title` too, harmless for desktop hover users).

Verified: `tsc --noEmit` and `eslint` clean on every file touched, home page and an NFT
detail page both load with zero console/HTML error markers against the running dev
server. Visual/touch verification at real mobile viewport widths was **not** done in
this pass — no browser tool was connected this session (same gap noted in the earlier
NFT redesign work) — this is CSS-logic-verified (correct breakpoint classes, confirmed
flex/overflow behavior reasoning) but not eyeballed on a real phone-sized viewport.
Worth a manual check before calling this fully done.

---

## 2026-08-03 — Deep improvement pass, Phase 1 (backend foundation): EVM chain coverage + a real points-crediting ordering bug found across 4 routes

Kicked off a broad, phased improvement plan (backend hardening → frontend/mobile UX →
new features) after a full 3-agent audit (backend/security, frontend/mobile,
Jupiter-integration research). Full plan tracked outside this repo; this entry covers
what actually shipped from Phase 1 so far.

**EVM chain coverage extended beyond Ethereum/Base** — `lib/nft/evmChains.ts`'s
`EVM_CHAINS` (the single source of truth for the browse picker, Relay's chain-id map,
and the buy flow's chain target) and `lib/chains/evm.ts`'s `CHAIN_CONFIG` both gained
Polygon (137), Arbitrum (42161), Optimism (10), Avalanche (43114). Every OpenSea
chain-slug was verified live (not guessed) against `GET /v2/collections?chain=...` —
worth noting: OpenSea's canonical Polygon slug is now `"polygon"`, not the older
`"matic"` (both are accepted, but a real collection's own `contracts[].chain` field
echoes back `"polygon"`, confirming which is current). Every new RPC fallback
(publicnode.com) was confirmed live via a raw `eth_chainId` call before being
committed, same discipline as the original mainnet/base entries. Verified end-to-end
against the running dev server: `/api/nft/collections?chainFamily=evm&chain=polygon`
(and arbitrum/optimism/avalanche) all return real collections. **Deliberately NOT**
extending to the other ~20 chains OpenSea supports (ApeChain, Berachain, Blast,
Abstract, Sei, Monad, HyperEVM, Zora, Ronin, Flow, Unichain, Soneium, Shape, Ink, B3,
GUNZ, Somnia, MegaETH, AnimeChain, Robinhood) — each needs the same live-slug-verification
treatment (see the "matic" gotcha above) rather than assuming the obvious name is right.

**Real bug found: points-crediting could turn an already-successful swap/purchase into
an error response for the user.** In `app/api/swap/confirm`, `app/api/bridge/confirm`,
`app/api/nft/purchase/confirm-buy`, and `app/api/nft/purchase/sui/confirm-buy` — all
four followed the same shape: verify the on-chain settlement (already correct, already
independently verified, not the bug), then call `creditSwapPoints`/`creditNftPurchasePoints`
*unguarded* before returning success. Two of the four (`swap/confirm`, one branch of
`bridge/confirm`'s Solana-origin path) call `lib/pricing.ts`'s `getSolUsdPrice()`
first — an external Jupiter price-feed call that has **already silently broken once
before** (the `price/v2`→`v3` retirement, 2026-07-18b). If that price fetch (or the DB
write itself) throws, the whole handler throws with no surrounding try/catch in three
of the four files, or (in `swap/confirm`) it throws *before* the `status: "complete"`
DB write for same-chain swaps — meaning a transient price-feed hiccup would leave a
swap that had genuinely succeeded on-chain either (a) permanently stuck reporting
`leg1_confirmed` instead of `complete`, with no code path to ever retry the transition,
or (b) returning a 502/500 to the user for a swap/purchase that actually worked.
**Fix**: in every one of the 4 routes, the "complete"/success DB write now always
happens first (reflecting the one fact that's already been independently verified —
the on-chain settlement), and points crediting is wrapped in its own try/catch,
logged loudly on failure (`console.error`), but never allowed to affect the response.
Points not being credited for one swap due to a transient price-feed issue is an
acceptable, recoverable-later gap; telling a user their successful swap failed is not.
No live repro of the original bug was forced (would need a real deliberately-broken
price feed against real funds) — the fix is a pure reordering + isolation, verified via
`tsc --noEmit` and `eslint` clean on all 4 files. **Correction to an earlier version of
this entry**: a route-handler-level test asserting this exact ordering
(points-crediting throwing must not prevent `{status: "complete"}`) was NOT built —
these 4 routes mix Next.js `Request`/`NextResponse`, a live Solana RPC connection
(`getParsedTransaction`), and Supabase, and properly testing them needs either heavy
mocking of all three or a fuller integration-test harness than this pass built. What
IS covered (see the Vitest section below): the price-fetching logic itself
(`lib/pricing.ts`, including a direct regression test replaying the exact response
shape that caused the original incident) and the points-crediting logic itself
(`lib/points.ts`, real integration tests). The specific reordering fix in these 4 route
files is verified by type-check/lint + careful manual read, not by an automated test —
a real, acknowledged gap, not silently claimed as covered.

**Two GET routes had an unvalidated `chain` query param flowing straight into a
Tradeport GraphQL query as an interpolated field selector** (`app/api/nft/collection`,
`app/api/nft/listings` — `${chain} { collections { ... } } }"`, see
`lib/nft/tradeport.ts`'s `COLLECTIONS_QUERY`). A third route
(`app/api/nft/collections`) already validated this correctly against a local
`TRADEPORT_CHAINS` array; the other two just did an unchecked `as TradeportChain`
cast. Fixed by exporting `TRADEPORT_CHAINS`/`isTradeportChain()` from
`lib/nft/tradeport.ts` as the one shared source of truth, and validating in both
previously-unguarded routes (400 with a clear message on an invalid value, same as the
route that already had this right). Verified live: a garbage `chain` value now 400s
instead of being silently accepted. Also: `lib/validation.ts`'s `isPlausibleEvmAddress`
upgraded from a bare hex-format regex to `viem`'s `isAddress` (confirmed live first —
default/non-strict mode accepts all-lowercase/uppercase addresses same as before, but
now correctly rejects a mixed-case address whose casing doesn't match its real EIP-55
checksum, which the old regex would have silently accepted). `app/api/points` was the
one route with zero rate limiting anywhere in the app (every other route has it) —
brought in line at 30/60s, matching the other lightweight authenticated GET routes.

**Audited the EVM-identity threat model** (standalone Sign-In-with-Ethereum,
`lib/auth/siwe.ts`'s `verifyEvmChallengeAndSignIn`, migration
`0008_evm_standalone_signin.sql`) against `SECURITY.md`/`AGENTS.md`'s stale claim that
Solana is "the only account identity mechanism" / "a user with only an EVM wallet
cannot use this app" — neither has been true since that migration shipped, and neither
doc had been updated to say so. **Good news from the audit: no actual bug found.**
Every route that needs a real Solana signer (`swap/route.ts`, `swap/confirm`, `quote`,
`nft/purchase/quote`, `nft/purchase/sui/quote`) already explicitly null-checks
`session.solanaPubkey` before using it, with its own appropriately-shaped error
response; `lib/points.ts` and `app/api/referral/route.ts` are already purely
`userId`-keyed with no Solana-specific assumptions anywhere, so points/referral
crediting already works correctly for EVM-only accounts. `requireSolanaSession()`
exists in `lib/auth/session.ts` for this exact null-check purpose but is unused
everywhere — confirmed this is fine, not a gap: every call site's manual check does
route-specific work (a different status code, or a side-effect DB write like marking
`leg1_failed`) that the generic helper can't replicate, so consolidating would only
make things worse. Fixed the documentation itself (`SECURITY.md`'s auth section,
`AGENTS.md`'s "Origins beyond Solana" section and its route listing) to describe both
sign-in paths accurately instead of the stale Solana-only claim.

**Set up real automated test coverage (Vitest) for the first time** — `package.json`
had no `test` script and zero `*.test.ts` files existed anywhere before this. Added
`vitest.config.mts` (aliases `server-only` to its own harmless `empty.js` so `lib/`
files can be unit tested without a full Next.js runtime — confirmed live that importing
a `server-only`-guarded file under plain Vitest throws otherwise) and started with the
money-math logic that's already broken silently in production before: `lib/fees.ts`
(bps env parsing/fallback), `lib/pricing.ts` (all three USD price fetchers — including a
direct regression test replaying the exact old `price/v2` response shape that caused the
2026-07-18b incident, confirming the current code correctly rejects it), and
`lib/client/amount.ts`.

**Writing that last one's tests found a real, live floating-point bug in
`roundUpTo2Decimals`**: `Math.ceil(value * 100)` alone bumps an already-exact 2-decimal
value to the WRONG next cent for specific inputs — `9.55 * 100` evaluates to
`955.0000000000001` in IEEE754 double precision (not exactly `955`), so `Math.ceil`
rounded it up to 956, displaying `"9.56"` instead of the correct `"9.55"`. This function
is used for every SOL/SUI price display across the NFT buy flow — a real, if narrow,
case where a buyer could have been shown a price one cent higher than the true one.
Fixed by rounding the intermediate cents value to 6 decimal places (stripping
floating-point noise, ~1e-13 relative magnitude — far below any real currency amount's
genuine precision) before applying the ceiling. Verified against the classic `0.1 + 0.2`
float trap and several boundary values, all correct now. This is exactly the kind of bug
the new test suite exists to catch — found on the very first file it touched.

Also added: `lib/validation.test.ts` (the EIP-55 checksum upgrade — including a real
finding that viem's `isAddress` treats all-lowercase as valid "no checksum info" but
all-*uppercase* as an actual checksum mismatch, asymmetric in a way worth documenting
since it's not obvious); `lib/auth/siws.test.ts` (SIWS replay protection — chose REAL
integration tests against the local Supabase instance over mocking Postgrest's chainable
query builder, since a mock of exactly the single-use/expiry logic under test risks
false confidence; generates real Solana keypairs and signatures via `tweetnacl`, verifies
a consumed/expired/wrong-signature challenge is correctly rejected, cleans up every row
it creates); `lib/points.ts` gets the same real-integration treatment (`lib/points.test.ts`
— dust floor, idempotency, referral-split math, all against a real inserted swap/quote/
user chain); `lib/nft/cryptopunksOnchain.test.ts` (the public-vs-private-offer filter —
extracted the filter+sort step into a standalone `filterAndSortPublicOffers` so it's
testable with synthetic multicall data instead of needing a live 10k-call chain scan
per test run).

**Final tally: 71 tests across 7 files, `npm test` green, `tsc --noEmit`/`eslint` clean
on everything touched.** Explicitly NOT covered in this pass (real gaps, not silently
skipped): the 4 confirm-route ordering fixes above (needs a heavier Next.js
route-handler test harness); `creditNftPurchasePoints` specifically (structurally
identical to the now-tested `creditSwapPoints`, its own fixture chain needs more setup
for marginal extra confidence); SIWE's standalone/link EVM flows (same DB-integration
approach as SIWS would work, just not built yet — the message-building and JWT pieces
those share with SIWS ARE covered via `lib/auth/siws.test.ts`'s
`issueSessionToken`/`verifySessionToken` tests, which both flows use identically); and
the quote-binding immutability invariant itself (`swap_quotes.dest_address`/
`consumed_at`) — planned as the next addition, not done here.

---

## 2026-07-22r — Real Sui logo added to chain tabs (was a plain glyph)

User: "ADD SUI PNG LOGO, LIKE SOLANA AND ETH." Followed the same rule
already documented in this file for Sui elsewhere ("never invent an
external image URL when a real verified source isn't available") — Relay
has no Sui coverage at all (confirmed 2026-07-21), so Solana/Ethereum's
`assets.relay.link` source doesn't extend to Sui. Found and verified a real
one instead: CoinGecko's own asset CDN — confirmed live via CoinGecko's own
API (`GET /coins/sui` → `id: "sui", symbol: "sui", name: "Sui"`, with this
exact image URL in the response), same host this app already trusts for
pricing (`lib/pricing.ts`'s `getSuiUsdPrice`/`getEthUsdPrice` already hit
CoinGecko's API).

- `lib/nft/labels.ts`: new `SUI_ICON_URL` export, wired into
  `NFT_CHAIN_FAMILIES`'s `move` entry (was `iconUrl: null`).
- `NftChainTabs.tsx` needed NO changes — it already renders whatever
  `iconUrl` a chain has generically (real `<img>` if set, plain glyph if
  `null`); setting a real URL was the entire fix.
- Fixing only the chain tabs was a deliberate scope call, not every
  possible "SUI mention": the per-wallet icons in `SuiConnectPicker.tsx`
  (Sui Wallet/Phantom/Slush logos) are already real via Wallet Standard, not
  a gap; the "Pay with SUI/SOL/ETH" toggle in `NftBuyModalSui.tsx` has no
  icons for ANY of the three currencies today (Solana/ETH don't get one
  there either), so adding one only for Sui there would be a new
  inconsistency, not a fix — left alone unless asked for specifically.
- Live-verified the real image URL renders in the actual page HTML, not
  just typechecked. `npx tsc --noEmit`, `npm run lint`, `npm run build` all
  clean.

---

## 2026-07-22q — Floor price display bug fixed; per-item image dead-host scope confirmed wider than first found

User: "WE STILL HAVE THE ISSUE IMAGE NOT SHOWING ON SUI NFTS LIST, ALSO THE
FLOOR PRICE IS NOT CORRECT WITH THE CHEAPER ASSET ON THE COLLECTION." Two
separate investigations, both against live data:

- **Floor price — real bug found and fixed, in OUR code, not Tradeport's
  data.** Cross-checked `collections.floor` against the actual cheapest
  active listing for Pawtato Heroes, Popkins, and DeSuiLabs directly — all
  three matched exactly (Tradeport's floor field is accurate). The real
  bug: 2026-07-22m's fee-inclusive display fix was applied to listing GRID
  cards (`×1.10`) but never to the collection header's "Floor Price" stat,
  which kept showing the raw un-marked-up number — the two no longer
  agreed on "the cheapest asset's price," reading as a wrong floor. Fixed:
  `NftCollectionStats.tsx` now applies the same `TRADEPORT_FEE_SAFETY_MARGIN`
  to the floor stat, Tradeport-only (other vendors already include their
  fees in displayed prices).
- **Images — confirmed the dead-host problem (2026-07-22n) is WIDER than
  first found.** That session only checked two arbitrary DeSuiLabs items and
  found them on IPFS (working). Checking the collection's actual CHEAPEST
  active listings (what a real user browsing the grid sorted by price would
  see first) shows several DeSuiLabs items ALSO hosted on the same dead
  `shdw-drive.genesysgo.net` domain — DeSuiLabs' own metadata is
  inconsistently split across IPFS (working) and GenesysGo Shadow Drive
  (confirmed dead, doesn't resolve via DNS) per-item, not just for the
  collection cover. **No code fix exists for this** — unlike the collection
  header (which has the first-listing fallback from 2026-07-22n), an
  individual listing card has no secondary image source to fall back to at
  all (Tradeport's schema has no alternate per-NFT media field, confirmed
  in that same session). These specific NFTs' images are genuinely gone
  from where DeSuiLabs' own metadata points — `NftImage`'s existing
  broken-image placeholder is the correct, honest behavior here, not a bug
  to keep chasing.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22p — Tradeport collection/listing data now cached — no separate image storage needed

User: "FOR COLLECTIONS IMAGES, WE CAN STORE THEM LOCALLY... MAYBE WE CAN GET
LINKS FROM WALRUS AND USE THEM, NOT EVEN NEED TO STORE THE IMAGES JUST THE
WALRUS LINK TO BE SERVED WITHOUT API CALL." Real, immediately actionable gap
found: `lib/nft/tradeport.ts` never used this app's existing `lib/cache.ts`
in-memory TTL helper AT ALL — unlike `lib/nft/opensea.ts`/`magiceden.ts`,
which already cache their collection data — so every single page view
re-hit Tradeport's live GraphQL API for the same collection/listing data,
burning the trial-key's call quota (already flagged as a concern: ~3 extra
calls per collection for enrichment) for zero benefit on repeat views.

- `browseTradeportCollections()` and `getTradeportCollection()`: wrapped in
  `cached()`, 5-minute TTL (`TRADEPORT_COLLECTIONS_TTL_MS`, same convention
  as OpenSea's `COLLECTIONS_TTL_MS`) — this caches Tradeport's ENTIRE
  response including whatever cover_url it carries (Walrus/IPFS/CDN link),
  which is exactly "get the link once and serve it without an API call"
  without needing a separate image-storage/proxy layer — no new
  infrastructure, just applying an existing pattern that was inconsistently
  missing from this one vendor file.
- `getTradeportListings()`: same treatment, shorter 2-minute TTL
  (`TRADEPORT_LISTINGS_TTL_MS`) since listing price/availability changes
  faster than collection metadata — this is purely a browse-display cache;
  the actual purchase flow's staleness guarantee
  (`isTradeportListingStillActive`/`buildVerifiedTradeportBuyTransaction`)
  is untouched and still NEVER cached, always hits Tradeport fresh right
  before a signature is requested, so this can't make a real purchase act
  on stale data.
- **Live-verified the actual speedup**, not assumed: same collection
  lookup, cold call 1.36s → cached call 29ms.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22o — Cross-chain bridging gets a real safety buffer: "add more SUI" after bridging is unacceptable

User, verbatim: "WE CANNOT BE WITH THIS MESSAGE SINCE THE USER TRUSTED US ON
THE PAYMENT WITH ANOTHER COIN, THIS IS UNNACEPTABLE" — correctly identifying
that a cross-chain buyer discovering a shortfall AFTER the ETH/SOL→SUI
bridge already ran is a real trust violation, not just an edge case to
message nicely. By that point they've committed real funds through an
irreversible conversion; asking them to "add a bit more" is not
acceptable as a routine occurrence.

- New `CROSS_CHAIN_BRIDGE_BUFFER = 0.01` (1%) in `lib/nft/tradeportFee.ts`,
  ON TOP of `TRADEPORT_FEE_SAFETY_MARGIN` (10%) — applied ONLY when sizing
  how much to bridge for the cross-chain (ETH/SOL) path, per user's own
  proposed fix. Same-chain SUI quoting is unaffected (it already gets the
  exact real cost via live dry-run, no estimate involved at all).
  Cross-chain quote sizing is now `listingPrice × (1 + 0.10 + 0.01)` =
  `× 1.11` instead of `× 1.10`.
- The confirm-deposit route's real dry-run + balance check (the CRITICAL
  fix from 2026-07-22i) stays in place as a safety net — a genuine
  guarantee isn't possible when a third party's fee (Tradeport's) isn't
  fully under this app's control, so the check can't be removed outright.
  The buffer's job is to make that path exceptional rather than routine;
  any leftover SUI beyond the real cost simply stays in the buyer's own
  wallet, same "never lost" reasoning as elsewhere in this app.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22n — Popkins/DeSuiLabs cover images: real root causes found, one real code fix, one genuinely unrecoverable

User: "POPKINS COLLECTION IMAGE IS NOT LOADING, ALSO DESUILABS, CHECK WHY."
Investigated both directly against live data rather than guessing — two
DIFFERENT root causes:

- **Popkins**: `cover_url` is `walrus://KsYK9AoYOaU2aaEMXx04BVfU_kS5-8wBWNhrsh__pCA`
  — Walrus (Mysten's own decentralized storage protocol), a scheme
  `lib/nft/tradeport.ts`'s `toHttpUrl()` never handled (only `ipfs://` was
  covered). **Real, general code bug, fixed**: added a rewrite to Walrus's
  public mainnet aggregator (`aggregator.walrus-mainnet.walrus.space/v1/blobs/`,
  confirmed live via docs.wal.app). **But this specific blob is gone** —
  confirmed live: Walrus's own aggregator returns a clean `BLOB_NOT_FOUND`
  for it. Walrus's storage model is NOT permanent by default (data is paid
  for a fixed number of epochs and can be garbage-collected after) — this
  blob has genuinely expired. Not fixable by any gateway rewrite; the data
  itself is gone from the network.
- **DeSuiLabs**: `cover_url` is `https://shdw-drive.genesysgo.net/...` —
  confirmed live the domain doesn't even resolve via DNS (`curl -v`:
  "Could not resolve host"). GenesysGo's Shadow Drive service appears to be
  discontinued entirely. Also genuinely unrecoverable at that URL.
- **Checked for an alternate field to fall back to first** — Tradeport's
  GraphQL schema has no `logo_url`/`image_url`/`banner_url`/etc. on
  `collections`, only `cover_url`. No cheaper fix available there.
- **Real fix implemented**: both collections' individual LISTED NFTs have
  working images on different hosts (DeSuiLabs' items are on IPFS, already
  handled; Popkins' items are on `storage.claynosaurz.com`, confirmed live
  200 after redirect) — `NftImage.tsx` gained a `fallbackSrc` prop: if the
  primary `src` fails to load, it now tries a second URL before giving up
  to the broken-image placeholder. `app/nft/[vendor]/[slug]/page.tsx`'s
  collection header now passes the first loaded listing's own image as
  `fallbackSrc` — confirmed live this resolves to Popkins' real Claynosaurz
  image when the broken Walrus cover fails.
- **Known remaining gap**: the collections BROWSE TABLE
  (`NftCollectionsTable.tsx`) has no listings loaded per-row (would need an
  extra fetch per collection just for a thumbnail fallback, too costly for
  a 20-collection page) — it still falls back to the plain broken-image
  placeholder for Popkins/DeSuiLabs specifically. Only the collection
  DETAIL page has the fallback. Worth a targeted fix later if this matters
  enough to justify the extra per-collection call.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean; live-verified
  the walrus:// rewrite, the dead GenesysGo host, and the working
  Claynosaurz fallback URL directly, not assumed.

---

## 2026-07-22m — Fee-inclusive price now shown everywhere, not just inside the buy flow

User: "ALSO THAT PRICE NEEDS TO BE SHOWN IN OUR PAGE, STILL SHOWING 9" — the
collection listing grid (and the buy modal's pre-quote header) were still
showing Tradeport's raw, un-fee'd `listings.price` (`9`), even though the
actual quote/buy flow had already been fixed to account for the ~10%
Tradeport fee. A browsing user would see "9 SUI" on the grid, click Buy,
and only THEN see the real ~9.90 figure — inconsistent and exactly the kind
of mismatch that prompted this whole investigation.

- New `lib/nft/tradeportFee.ts` — `TRADEPORT_FEE_SAFETY_MARGIN` moved out of
  `lib/chains/sui.ts` (which has a `server-only` import, unusable from
  client components) into this new, deliberately NOT-server-only file, so
  the same constant can be shared between server purchase routes and
  client display code. `lib/chains/sui.ts` re-exports it so no existing
  server-side importer needed to change.
- `app/nft/[vendor]/[slug]/page.tsx`: new `displayedListingPrice()` — shows
  `price × 1.10` for Tradeport listings specifically (OpenSea/Magic Eden
  already include their own fees in the displayed price, confirmed in
  earlier sessions — this adjustment is Tradeport-only).
- `NftBuyModalSui.tsx`: the pre-quote header price now applies the same
  margin (previously showed the bare listing price before any quote
  existed). Also fixed the post-quote breakdown text, which said "Includes
  the listing price plus network gas" — silently omitting that Tradeport's
  own marketplace fee is the actual biggest addition on top of price, not
  just gas. Now explicitly says "listing price, Tradeport's own marketplace
  fee, and network gas."
- The underlying quote/execute/confirm-deposit routes are UNCHANGED — they
  already computed the real number correctly; this pass only fixes what's
  DISPLAYED before and outside the active quote flow.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22l — Fee-margin fallback tightened 20%→10%, ChangeNOW's own fee confirmed already netted in

User flagged the 20% fallback estimate as too padded — a real 9-SUI listing
showed "needs roughly 10.80 SUI" (20% margin) via a wallet too underfunded
for the real dry-run to succeed. Discussed a "probe address" fix (dry-run
against a well-funded address regardless of the real buyer's balance, to
get an exact number even when the buyer can't afford it) — user deferred
that (open item below) and asked to just tighten the margin to 10% instead,
matching the one real data point already known (~9.8%) more closely.

- `TRADEPORT_FEE_SAFETY_MARGIN`: `0.2` → `0.1`. Single source of truth
  (both cross-chain quote sizing and the same-chain/cross-chain
  insufficient-funds fallback display all read this one constant — no
  other stale `20%`/`1.2` references found via grep).
- User separately asked whether ChangeNOW's own bridging fee needs adding
  on top for the cross-chain path — confirmed it does NOT: the `reverse`
  quote type (see `getChangeNowReverseEstimate`) already nets deposit/
  withdrawal fees into the returned `fromAmount` — live-verified earlier
  (2026-07-22): requested exactly 20 SUI out, got back `toAmount: "20"` in
  the response, proving fees are already inside `fromAmount`, not stacked
  separately. Documented directly in `TRADEPORT_FEE_SAFETY_MARGIN`'s comment
  so this isn't re-litigated/double-added later.
- **Open item, deferred by user**: a "probe address" (any Sui address with
  a real SUI balance, used ONLY for read-only dry-run simulation — no
  private key/signing involved) would let the app get the REAL exact
  Tradeport fee for any listing regardless of the actual buyer's balance,
  instead of this flat 10% guess. User was in the process of providing one
  when this session's context was captured — revisit if/when an address is
  given; would slot into `estimateTradeportBuyCostMist`/
  `buildVerifiedTradeportBuyTransaction`'s fallback path specifically (real
  dry run against the buyer still tried first; probe address only used when
  that fails due to insufficient balance).
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22k — Same-chain SUI quotes now show the REAL exact cost, not an estimate

User: "when we try to buy direct from SUI, we can try to quote it direct in
tradeport, to have the final cost of the nft" — a real, correct
observation: the `TRADEPORT_FEE_SAFETY_MARGIN` estimate (added in
2026-07-22i's critical fix) only exists because a CROSS-CHAIN buyer has no
funds to dry-run against until after bridging. A same-chain SUI buyer's
wallet already holds real funds at quote time — no chicken-and-egg problem
at all, so there's no reason to estimate.

- `app/api/nft/purchase/sui/quote/route.ts`: same-chain path now calls
  `estimateTradeportBuyCostMist()` directly (the real dry-run function from
  the critical fix) instead of `listingPrice × (1 + margin)` — the quoted
  "You pay" figure is now the EXACT true cost, same number
  `buildVerifiedTradeportBuyTransaction` will re-confirm at execute time
  (that second check remains — it's the staleness re-check, not redundant).
- Handles the underfunded case cleanly: if the dry run fails outright
  (`SuiInsufficientBalanceError`), the quote route now returns a clear
  "your wallet doesn't have enough SUI (needs roughly X, including
  Tradeport's fees)" error immediately, instead of only discovering this
  several steps later at execute time.
- Cross-chain (ETH/SOL) quotes are UNCHANGED — still the
  `TRADEPORT_FEE_SAFETY_MARGIN` estimate, since that limitation is real
  (see 2026-07-22i's doc: no EVM-style balance-override exists for Sui
  dry-runs, and the buyer genuinely has zero SUI before bridging completes).
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22j — Fixed: round-number prices showed no decimals in the buy modal

User: "Pawtato Hero #8487, 9.000 SUI, we do not get decimals" — real
regression from the earlier 2026-07-22g rounding change. Verified against
real data first: Tradeport's raw price for #8487 really is exactly
9000000000 MIST (9.000000000 SUI, no hidden precision) — not a data bug.
The actual bug: `roundUpTo2Decimals()` returned a bare JS `number`, and
`Math.ceil(9 * 100) / 100` is the number `9`, not `9.00` — rendered directly
in JSX that shows as the literal text "9", with no decimal point at all,
inconsistent with the listing grid's `.toFixed(3)` display ("9.000")
elsewhere on the same page.

Fixed: `roundUpTo2Decimals()` now returns a string via `.toFixed(2)` after
the ceiling rounding, guaranteeing exactly two decimal places every time
(`9` → `"9.00"`, `9.881` → `"9.89"`) — same convention as every other price
display in this app. `npx tsc --noEmit` confirmed no caller broke (all of
them only ever used the result for display, never further arithmetic).
`npm run lint`, `npm run build` also clean.

---

## 2026-07-22i — 🔴 CRITICAL FIX: Tradeport purchases were undercharged, silently overdrawing unrelated wallet balance

User reported (after a real completed purchase): "I received 9.05 SUI and
the NFT costs me -9.88 SUI." Investigated with real on-chain data rather
than guessing:

- **Ground truth, from the actual completed transaction**
  (`DhVc5jLz1A5DDttQxT8j8UwNsMoZeEpLifBg2jDVgojF`, fetched directly from
  mainnet): the buyer's real net SUI balance change was **-9.882504784
  SUI**, against a 9 SUI listing price. The extra **0.8825 SUI (~9.8%)**
  appears in NO event and NO other address's balance change — almost
  certainly Kiosk-internal profit accounting (Sui's Kiosk primitive holds
  sale proceeds inside the Kiosk object itself, not as a plain wallet
  balance change), invisible to the `listings.price` GraphQL field this app
  was quoting from entirely. This app had quoted/delivered exactly 9.05 SUI
  (price + a flat 0.05 SUI gas buffer) — 0.83 SUI short of the real cost.
  The purchase still completed because the buyer happened to have enough
  OTHER pre-existing SUI in that wallet to cover the gap — silently, with
  no warning. A wallet with exactly the "quoted" amount and nothing else
  would have hit a hard on-chain failure instead.
- **The fix has two parts**, both implemented and live-verified:
  1. **Never trust `listings.price` as the total cost again.**
     `lib/chains/sui.ts`'s new `dryRunSuiTransactionCostMist()` dry-runs the
     ACTUAL buy transaction (the same one that gets signed) and reads the
     real net SUI cost from the simulation's `balanceChanges` — this
     captures price + fee + gas exactly, regardless of what Tradeport (or
     any other collection with different royalty terms) actually charges.
     Same principle as `lib/chains/evm.ts`'s `estimateBuyCallTotalCostWei`.
  2. **A real dry run needs the sender to already own SUI** to resolve gas
     payment (confirmed live: fails outright against a genuinely empty
     address, and Sui's dry-run RPC has no EVM-style balance-override
     param) — impossible at QUOTE time for a cross-chain buyer who hasn't
     been bridged funds yet. New `TRADEPORT_FEE_SAFETY_MARGIN = 0.2` (20%,
     comfortably above the real observed 9.8%) sizes the bridge amount at
     quote time as an ESTIMATE. The real, authoritative check now happens
     via new `buildVerifiedTradeportBuyTransaction()`
     (`lib/nft/tradeportBuy.ts`) at the LAST possible moment before a
     signature is requested — same-chain execute route and cross-chain
     confirm-deposit route both now call it, by which point real funds
     exist (same-chain always had them; cross-chain has already bridged) —
     and it BLOCKS with a clear `insufficient_funds` status + exact
     required/available SUI figures instead of returning a signable
     transaction, closing the exact loophole that let this happen silently.
- **Second real gap found and fixed while building the check itself**: a
  SEVERELY underfunded wallet (confirmed live: 1.52 SUI trying to buy a 15
  SUI listing) makes the dry run fail OUTRIGHT
  (`"InsufficientCoinBalance in command 1"`) rather than succeed with a
  clean negative balance change — my first pass at this fix would have
  thrown an unhandled error (502) in that case instead of the intended
  clean `insufficient_funds` response. Fixed: new
  `SuiInsufficientBalanceError`, caught by
  `buildVerifiedTradeportBuyTransaction()` and reported with `costMist:
  null`; both routes fall back to the same listing-price + safety-margin
  estimate for display in that case (honestly labeled as an estimate, not
  claimed exact).
- **Live-verified** both branches directly against real mainnet data before
  trusting the fix: (1) the exact real-completed-purchase transaction
  confirms the -9.8825 SUI ground truth: (2) a real dry run against a
  genuinely underfunded real address reproduces the
  `SuiInsufficientBalanceError` path and confirms it's now caught instead of
  crashing. `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- **Not yet re-verified with an actual new signed purchase** (needs the
  user to try again) — the fix is live-tested at the dry-run/simulation
  level but the full end-to-end flow with a real new signature hasn't been
  re-exercised since this fix landed.

---

## 2026-07-22h — Real bug fix: double-encoded slug 404'd Tradeport collections containing `::`

User hit "Collection not found" on Pawtato Heroes and Popkins — both real
Tradeport collections whose `slug` is a full Move type path (e.g.
`0xe0fa...::pawtato_heroes::HERO`), not a bare package address like Fuddies.
Confirmed the Tradeport API itself and our own `/api/nft/collection` route
both work fine for these slugs when called directly — the bug was
client-side only.

- Root cause, confirmed via the dev server log: the failing requests carried
  `%253A%253A` in their query string — `%3A` (a colon) encoded a SECOND
  time — while a fresh/first request for the same page correctly carried
  single-encoded `%3A%3A`. `app/nft/[vendor]/[slug]/page.tsx` calls
  `encodeURIComponent(slug)` once per fetch, which is only correct if `slug`
  (from the dynamic route param) is already the raw decoded string — that
  assumption didn't hold on every navigation path.
- Fixed by decoding defensively: `const slug = decodeURIComponent(rawSlug)`
  right after destructuring `params`, before any fetch call touches it —
  guarantees single-encoding downstream regardless of what shape the route
  param arrives in. Safe unconditionally (no vendor's slugs contain a
  literal `%`, so decoding an already-decoded string is a no-op).
- Only reproducible via a real client-side navigation (clicking a collection
  link, not a fresh page load/curl) — couldn't fully re-verify end-to-end
  without browser automation (unavailable this session); asked the user to
  confirm by clicking through from the browse table again.
- **Root cause pinned down precisely** (user asked to confirm this, not
  leave it as a guess): read Next.js 16.2.10's own installed source,
  `node_modules/next/dist/client/route-params.js`. It has a function,
  `canonicalizeURLPart`, built SPECIFICALLY to guard against this exact bug
  class — its own comment: *"Pathname parts come from `URL.pathname.split
  ('/')`, so they are already in the encoded form the URL parser produces.
  The server-side equivalent... applies `encodeURIComponent` once. The two
  encodings are not the same — for example, the URL parser leaves `,` and
  `:` untouched while `encodeURIComponent` percent-encodes them. To produce
  the same canonical form on the client (and avoid double-encoding `%xx`
  sequences such as `%2F` → `%252F`)..."* — `%2F`→`%252F` is the EXACT same
  failure shape as our `%3A`→`%253A` (a colon instead of a slash). This is a
  known, framework-level rough edge in how the App Router's client-side
  router reconciles dynamic segments containing characters
  `encodeURIComponent` treats differently than a raw `URL.pathname` parser
  does (`:`, `,`, and a few others) — not a bug unique to this app, and not
  something guessable-away without checking the actual framework source.
  This app's own defensive fix (decode once before any use, re-encode
  exactly once per downstream fetch) is the same mitigation technique
  Next's own internal `canonicalizeURLPart` uses, applied at the one place
  in this app (`app/nft/[vendor]/[slug]/page.tsx`) that consumes a slug
  route param — confirmed via grep that this is the ONLY such consumer
  (`NftCollectionsTable.tsx`'s `href` builder encodes once when
  constructing links, which is correct and untouched), so the fix covers
  every current and future Tradeport/OpenSea/Magic Eden collection
  regardless of what characters its slug contains — not a per-collection
  patch.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22g — ChangeNOW min/max range handled as a clean error + amount display rounding

User hit `ChangeNOW estimate failed (400): {"error":"not_valid_params",
"message":"amountTo is too small",...}` trying to pay with SOL for a cheap
(0.35 SUI) listing. This is a real, expected business constraint — every
exchange has a minimum economical trade size — not a bug, but it was
surfacing as a raw, scary 502.

- `lib/chains/changenow.ts`: new `ChangeNowAmountOutOfRangeError` — parses
  ChangeNOW's own 400 `not_valid_params` payload (which carries the real
  min/max range for the ORIGIN currency, despite the error text saying
  "amountTo") instead of throwing a generic error.
- Sui purchase quote route now catches this specifically and returns a
  clean 400 with an actionable message: the minimum in the origin currency
  AND its SUI-equivalent value (computed via the existing SOL/ETH/SUI USD
  price helpers), suggesting "Pay with SUI" or a higher-priced listing as
  the fix.
- User also asked: round displayed SOL/SUI amounts to 2 decimals, always
  rounding UP (never down/nearest) — a rounded-down display could
  understate what's actually needed. Added `roundUpTo2Decimals()` to
  `lib/client/amount.ts` (plain math, no `server-only` restriction, usable
  from both the API route and `NftBuyModalSui.tsx`'s display). Applied to
  the modal's listing-price header, the "You pay" quote line, and the
  ChangeNOW range error message.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22f — Real bug fix: Tradeport GraphQL `String!` vs `uuid!` — every Sui quote was 502ing, listedCount was always silently undefined

User hit a 502 quoting "allegiants.sui" (a SuiNS domain-name NFT, 0.35 SUI,
in the SuiNS collection) with "Pay with SOL." Reproduced directly against
Tradeport's real API rather than guessing:

- **`isTradeportListingStillActive`'s `LISTING_BY_ID_QUERY`** declared
  `$id: String!` — Tradeport's GraphQL validation rejects this outright
  (`"variable 'id' is declared as 'String!', but used where 'uuid' is
  expected"`, confirmed live). `listings.id` is a uuid column. **This meant
  EVERY Sui NFT quote/execute/confirm-deposit call 502'd unconditionally**
  (not just this one listing) — the very first call in every one of those
  three routes calls this function. Fixed: `$id: uuid!`, confirmed live
  (`{"id":"...","price":350000000}` returned correctly).
- **Same bug, independently discovered while checking for it elsewhere**:
  `LISTED_COUNT_QUERY`'s `$collectionId: String!` has the identical mistake
  (`collection_id` is also a uuid). This one was NEVER visibly erroring —
  `enrichCollection`'s `Promise.allSettled` (built for transient upstream
  failures) silently swallowed it, so every Tradeport collection's
  `listedCount` has been quietly `undefined` since the field was added,
  masquerading as "just not available" rather than a real bug. Fixed:
  `$collectionId: uuid!`, confirmed live — SuiNS now returns a real
  `listedCount: 3459` (previously always missing).
- Checked every other `String!` variable in `lib/nft/tradeport.ts` for the
  same class of mistake — all the rest filter by `slug` (a real Move
  package address string, not a uuid), confirmed correct as-is.
- **Lesson worth generalizing**: `Promise.allSettled`-wrapped enrichment
  calls are the right shape for genuinely transient failures, but they can
  also permanently hide a real, deterministic bug behind a "field just isn't
  available" appearance — worth occasionally checking what a "gracefully
  degraded" field's rejection reason actually is, not just that it degrades
  gracefully.
- `npx tsc --noEmit`, `npm run lint` clean; live-verified via the actual
  running dev server, not just the raw GraphQL calls.

---

## 2026-07-22e — Slush wallet support for Sui connect

User: "for SUI WALLET connection, also be able to use Slush wallet." Slush
is Mysten's own wallet (formerly "Sui Wallet"/"Stashed") — its browser
extension and mobile app already worked automatically via Wallet Standard
(no code needed, same as Phantom's Sui support), but the Slush WEB wallet
(no-install, zkLogin/social login) needs explicit registration to appear.

- Checked `@mysten/dapp-kit`'s own `WalletProvider` type definitions first
  rather than assuming a separate package was needed — confirmed it has a
  built-in `slushWallet?: { name, origin? }` prop
  (`hooks/wallet/useSlushWallet.d.ts`). Installed the standalone
  `@mysten/slush-wallet` package initially, found the built-in prop, then
  uninstalled it again — dapp-kit doesn't need it (that package is only for
  apps not already using dapp-kit).
- `lib/client/SuiWalletProvider.tsx`: added `slushWallet={{ name:
  "SwapperBetweenChains" }}` to the `WalletProvider`. Per Mysten's own docs:
  if the Slush extension is installed, the connect modal shows just that;
  otherwise it falls back to the web wallet automatically — no UI branching
  needed on our side, `SuiConnectPicker.tsx` lists whichever form is active
  the same way it already lists Sui Wallet/Phantom.
- `npx tsc --noEmit`, `npm run lint` both clean; dev server confirmed
  rendering both `/nft` and a Sui collection detail page without error.

---

## 2026-07-22d — Added "Pay with SOL" for Sui NFT purchases (ChangeNOW SOL→SUI, real liquidity confirmed)

User: "also for sui put available paying with SOL." Confirmed live first
(same discipline as ETH): `SOL→SUI` reverse estimate returned real numbers
(0.15099337 SOL for an exact 15.05 SUI output), and a real (unfunded)
exchange returned a genuine base58 Solana deposit address.

- `lib/chains/changenow.ts` generalized: `getChangeNowReverseEstimate`/
  `createChangeNowExchange` now take a `fromCurrency: "eth" | "sol"` param
  instead of being ETH-hardcoded — both origins use the identical
  `estimated-amount`/`exchange` endpoints, just a different ticker/network
  string (ChangeNOW's ticker equals network name for both natives).
- Sui purchase quote route: `payWith` is now `"sui" | "eth" | "sol"`. SOL
  origin reuses the EXACT same pattern the OpenSea purchase quote already
  established for its Solana-origin path — the signer is always
  `session.solanaPubkey` (requires a Solana-anchored session), never a
  separately-passed address, and `origin_chain_id` reuses the app-wide
  `SOLANA_CHAIN_ID` sentinel from `lib/chains/relay.ts` for consistency
  (even though ChangeNOW itself never sees that numeric id — it's purely
  this app's internal bookkeeping convention).
- `NftBuyModalSui.tsx`: three-way "Pay with SUI / SOL / ETH" toggle. New
  `lib/client/solanaTransfer.ts`'s `buildSolTransferTransaction()` — a plain
  `SystemProgram.transfer`, deliberately NOT reusing
  `lib/client/relayTransaction.ts`'s raw-instruction parsing (that's
  Relay-specific bridge-instruction data; ChangeNOW's deposit is just a
  wallet-to-wallet value transfer, same simplicity as the ETH deposit).
  Reuses the existing `@solana/wallet-adapter-react` `useWallet`/
  `useConnection` hooks and `WalletMultiButton` already wired up elsewhere
  in the app — no new Solana wallet-connect infra needed.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2026-07-22c — Squid Router REPLACED with ChangeNOW for ETH→SUI (real liquidity confirmed live)

User: "its an issue from their end, will discard that" (Squid) — asked to
implement ChangeNOW (changenow.io/api) instead, provided a real API key
same session. Live-tested before writing any integration code, same
discipline as every other vendor here:

- **Real liquidity confirmed**: `GET /v2/exchange/estimated-amount` for
  eth→sui returned real numbers (0.05 ETH → ~124 SUI, standard flow; ~123.3
  SUI fixed-rate). `type=reverse` + `flow=fixed-rate` (exact-output, the
  ChangeNOW equivalent of Relay's `/quote/v2` EXACT_OUTPUT) confirmed too —
  asked for exactly 20 SUI out, got back 0.00816136 ETH + a `rateId` valid
  ~10 minutes. A real (harmless, unfunded) exchange was created end-to-end
  via `POST /v2/exchange`, returning a real `payinAddress` + exchange `id`;
  `GET /v2/exchange/by-id` returned the expected `status`/`payinHash`/
  `payoutHash` shape.
- **Materially different trust model from Relay/Squid, documented not
  hidden**: ChangeNOW is a CUSTODIAL exchange — the buyer sends a PLAIN
  native-ETH transfer (no contract call at all) to a deposit address
  ChangeNOW itself controls; ChangeNOW's own systems send SUI to the payout
  address afterward. This is real counterparty risk (same category as using
  Coinbase/Binance to convert currency), not asserted to be trustless the
  way Relay/Squid's on-chain bridging is. Still preserves this app's core
  two-signature safety property: the buyer's own Sui wallet is what
  ultimately holds the SUI and signs the Tradeport buy itself (see migration
  0006's original design reasoning) — full detail in
  `lib/chains/changenow.ts`'s top comment.
- **Replaced, not added alongside**: deleted `lib/chains/squid.ts` entirely
  (per user's explicit "discard that") rather than leaving unused dead code.
  New `lib/chains/changenow.ts` — `getChangeNowReverseEstimate()` (no side
  effect, used by the quote route), `createChangeNowExchange()` (the actual
  side-effecting step, used by execute — mirrors this app's existing
  "quote is non-binding, execute commits" convention), `getChangeNowExchangeStatus()`.
- **Simpler execution than Squid/Relay would have been**: no
  gas-estimation-with-state-override complexity (unlike OpenSea's Seaport
  call) — just a plain value transfer, reusing `useEvmWallet.sendStepAndWait`
  with `data: "0x"`.
- **Schema**: migration `0012_nft_purchase_changenow.sql` adds
  `bridge_exchange_id`/`bridge_deposit_address` to `nft_purchase_quotes`.
  `bridge_quote` (added in 0011 for Squid) was already documented as
  vendor-agnostic — reused as-is for ChangeNOW's estimate response, no
  rename needed. Confirm-deposit no longer needs a client-reported deposit
  tx hash at all (unlike Squid) — the exchange id is already known
  server-side from execute, a real simplification.
- **`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean** after
  the full rewrite (quote/execute/confirm-deposit routes,
  `NftBuyModalSui.tsx`'s deposit step, `.env.example`).
- **Not yet observed live**: a `status: "finished"` response with a real
  `payoutHash` — needs an actual funded test exchange (the created exchange
  above was deliberately left unfunded). First real signed cross-chain test
  purchase is still the concrete next step, same as same-chain Sui buying.

---

## 2026-07-22b — Real SQUID_INTEGRATOR_ID obtained, live-tested: 2 real bugs fixed, 1 real liquidity gap found

User applied for and received a real Squid integrator id same-day (self-serve
Typeform, no manual approval wait — https://squidrouter.typeform.com/integrator-id).
Set in `.env.local`, then live-tested against the real API before trusting
the previous session's docs-derived code any further.

- **Bug 1 — wrong base URL**: `lib/chains/squid.ts` used
  `apiplus.squidrouter.com` (from the earlier docs pass) — this 403'd
  ("swaps are currently unavailable") on `/route` even with the real key.
  `/chains`/`/tokens` happen to work on both hosts, which is why this wasn't
  caught last session. The real, working host is `v2.api.squidrouter.com`,
  confirmed via a real curl example from Squid's own API docs page and
  verified live. Fixed.
- **Bug 2 — wrong request body field**: used `slippageConfig: {autoMode: 1}`;
  the real API (and every working docs example) uses a flat
  `slippage: <number>`. Fixed. (Root cause of both: last session's Squid
  integration was built entirely from docs text with no real key to verify
  against — flagged as such at the time, now corrected.)
- **Response shape CONFIRMED correct after both fixes**: a real ETH(mainnet)
  → Arbitrum quote returned exactly what `getSquidRoute()` reads —
  `route.estimate.fromAmountUSD`/`toAmount`, `route.transactionRequest.
  {target,data,value,gasLimit}`. No further field-name changes needed.
- **⚠️ Real, unresolved gap: Squid's Sui liquidity is currently too thin for
  this feature.** Every ETH→Sui quote attempted (native SUI and FDUSD.axl
  destinations, amounts from 0.001–0.05 ETH, several fresh addresses to rule
  out per-address throttling) returned `"Low liquidity, please reduce swap
  amount and try again"` (500) — including amounts far below what a real NFT
  purchase would need. Squid's own `/tokens` list carries only 5 Sui-side
  tokens total (SUI, FDUSD.axl, M-BTC, ITHACA, one test token), consistent
  with a genuinely early/thin Sui integration on Squid's side rather than a
  request problem — the identical code path succeeds immediately for EVM↔EVM
  chains. **The ETH-origin cross-chain Sui NFT purchase path cannot go live
  until this changes on Squid's end** — worth re-testing periodically (no
  code change needed when it does, just re-run a real quote). Same-chain SUI
  purchases (pay with native SUI, no Squid involved at all) are completely
  unaffected and already work today (see 2026-07-22 entry below).

---

## 2026-07-22 — Sui NFT wallet connect + full buy flow (same-chain SUI and cross-chain ETH via Squid Router)

User asked to bring Sui NFT buying to parity with the ETH flow: wallet connect
(Phantom + Sui Wallet) and real buy execution paying in either SUI or ETH. Two
real architecture findings up front, both confirmed live before writing code:

- **Relay has NO Sui/Move VM support at all** — confirmed against its own
  `/chains` endpoint (evm, svm, bvm, tvm, tonvm, hypevm, lvm; no Move VM).
  This means the ETH→SUI cross-chain leg could not reuse Relay the way Base
  was added — needed a different bridge entirely. User explicitly chose
  "add a new bridge now" over "same-chain only for now" when asked.
- **Squid Router (apiplus.squidrouter.com) supports `sui-mainnet` natively**,
  landing NATIVE SUI (not a wrapped asset) — confirmed live via its real
  `/chains` and `/tokens` endpoints. `/route` (actual quoting) 403s without a
  real approved `x-integrator-id` — same gated-approval-form pattern as
  Tradeport/Magic Eden elsewhere in this app (~24h, short form). **Not
  created on the user's behalf**, same reasoning as every other gated vendor
  here. `SQUID_INTEGRATOR_ID` in `.env.example`, currently unset — the
  ETH-origin path is code-complete but not yet live-testable until it exists.
  Same-chain SUI purchases don't need it at all.

### Real bugs found and fixed along the way (pre-existing, not introduced this session)
1. **`app/api/nft/collection/route.ts` had NO Tradeport branch at all** —
   every `/nft/tradeport/{slug}` collection detail page 404'd unconditionally,
   before a buyer could ever see a listing or a Buy button. Added
   `getTradeportCollection()` (new `COLLECTION_BY_SLUG_QUERY`, confirmed live)
   and wired it in.
2. **Tradeport's listings query never selected `id`** (only `nft_id`) and had
   no server-side price filter — same "most rows are stale/null-price" issue
   already known for `listings_aggregate` (Fuddies: 12,731 raw rows vs 530
   real), just not yet applied to the listings query itself. Fixed:
   `where: { price: { _is_null: false } }, order_by: { price: asc }` +
   selected `id` (what `buyListings()` actually keys off — nft_id is the
   wrong id for that call). Confirmed live: now returns real, cheapest-first,
   priced listings.
3. **`cover_url`/`media_url` are raw `ipfs://` URIs** (confirmed live on
   Fuddies) — browsers can't resolve those natively; every Tradeport image
   would have silently failed to load. Added a gateway rewrite (`ipfs.io`) in
   `lib/nft/tradeport.ts`'s `toHttpUrl()`.
4. `lib/nft/labels.ts` had Sui hardcoded `available: false` ("Upcoming") —
   flipped now that buy execution exists; `app/nft/page.tsx` needed a
   `chain=sui` default param the move family never had (collections route
   requires `chain` for `chainFamily=move`, confirmed by a direct 400 before
   this fix).

### What was built
- **Sui wallet connect**: `@mysten/dapp-kit` (official Mysten SDK, Wallet
  Standard discovery — same shape as EIP-6963/`wallets={[]}` already used for
  EVM/Solana) + `@mysten/sui` + `@tanstack/react-query` (peer dep).
  `lib/client/SuiWalletProvider.tsx` wraps the app; `SuiConnectPicker.tsx`/
  `SuiWalletButton.tsx` mirror the existing EVM picker/button components.
  **Real API-version gotcha**: the installed `@mysten/sui` v2.x renamed
  `SuiClient`→`SuiJsonRpcClient` and `getFullnodeUrl`→`getJsonRpcFullnodeUrl`,
  moved from `@mysten/sui/client` to `@mysten/sui/jsonRpc` (JSON-RPC is now
  flagged deprecated in favor of gRPC/GraphQL clients upstream, but it's what
  dapp-kit's `SuiClientProvider` still expects/returns in this version) —
  caught immediately via `tsc`, not guessed from stale docs/training data.
- **Tradeport buy execution** (`@tradeport/sui-trading-sdk`, a SEPARATE
  client/credential-shape doc tree from the GraphQL "NFT Data API" already
  used, confirmed live via tradeport.xyz/docs/nft-trading-sdk — same
  `apiKey`/`apiUser` values work for both). `lib/nft/tradeportBuy.ts`'s
  `buildTradeportBuyTransaction()` calls `buyListings({listingIds,
  walletAddress})`, which returns a real `@mysten/sui` `Transaction` object —
  **live-tested against a real active Fuddies listing** (a throwaway wallet
  address, quote-only, nothing signed): got back a real serializable
  transaction, `tx.serialize()` round-trips through `Transaction.from()`
  client-side for `@mysten/dapp-kit`'s `useSignAndExecuteTransaction`, same
  "server builds, client signs" shape as OpenSea's `getOpenSeaBuyCall`.
- **`lib/chains/squid.ts`** — Squid Router client (chains/tokens confirmed
  live keyless; `/route`+`/status` built against Squid's documented shape,
  flagged as NOT YET LIVE-VERIFIED pending a real integrator id — same
  transparency convention as every other pre-key vendor integration here).
- **`lib/chains/sui.ts`** — server-side Sui RPC, `isSuiTxSuccessful()` mirrors
  `lib/chains/evm.ts`'s `isEvmTxSuccessful()` exactly (never trust a
  client-reported digest before crediting points).
- **DB**: migration `0011_nft_purchase_sui.sql` — `origin_chain_id` relaxed to
  nullable + new `origin_chain_slug`/`origin_address`/`move_chain`/
  `tradeport_listing_id`/`bridge_quote` columns (same nullable-plus-check-
  constraint shape as `users.solana_pubkey`/`evm_verified_address`, migration
  0008) — a quote needs ONE of `origin_chain_id`/`origin_chain_slug`, since
  Squid addresses Sui as the string `"sui-mainnet"`, not a numeric chain id
  the existing bigint column could hold. `nft_purchases`' existing status
  enum needed no changes — "deposit"/"buy" already generalize correctly.
- **4 new API routes** mirroring the OpenSea purchase state machine exactly:
  `app/api/nft/purchase/sui/{quote,execute,confirm-deposit,confirm-buy}`.
  Same-chain SUI skips straight to a buy transaction (one signature, like the
  same-chain ETH path); cross-chain ETH bridges via Squid first (Sui wallet
  only signs once SUI has actually landed). Squid quotes EXACT_INPUT only
  (no Relay-style EXACT_OUTPUT solve) — sized via a USD-value conversion
  (listing price + gas buffer, ETH/SUI via CoinGecko) plus a 1.1x safety
  margin for price movement during bridging; any leftover SUI simply stays
  in the buyer's own wallet, never lost.
- **`app/components/NftBuyModalSui.tsx`** (new) — mirrors `NftBuyModal.tsx`'s
  structure/states exactly, Sui side. Real architectural note: Sui has no
  SIWS/SIWE-equivalent sign-in of its own, so `requireSession()` is satisfied
  by whatever session already exists (Solana OR EVM) — the Sui wallet is
  purely a signing/receiving tool here, same role the EVM wallet already has
  in the Solana-origin OpenSea path.
- `lib/pricing.ts` gained `getSuiUsdPrice()`/`mistToUsd()`, mirroring the
  existing ETH pair, for same-chain (and cross-chain fallback) USD-volume
  points crediting.

### Verified live, this session
`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean. Collection
detail + listings routes confirmed live with real Fuddies data (fixed image
URLs, real prices, real listing ids). `buildTradeportBuyTransaction()`
confirmed live end-to-end against a real active listing (quote-only, no
signature). `/nft?family=move` and the Sui collection detail page both
confirmed rendering (200) through the actual dev server.

### Not done / explicitly still open
- **Squid `/route`/`/status` field names are docs-derived, not live-verified**
  (blocked on `SQUID_INTEGRATOR_ID` — apply at docs.squidrouter.com). Once a
  real key exists: live-test a real quote, confirm the destination-digest
  field name in `/status`'s response (`toChain.transactionId` is a
  best-guess), then a real signed cross-chain test purchase.
- **No real signed test purchase yet on EITHER path** (same-chain or
  cross-chain) — needs the user's own funded Sui + EVM wallets, same
  "queue item #5" caveat that's applied to every other buy-execution feature
  in this app so far.
- **Aptos/Movement buy execution not built** — Tradeport's Trading SDK is
  Sui-specific (`@tradeport/sui-trading-sdk`); an Aptos equivalent would need
  its own SDK/investigation. Browse/listings already work for all three
  Tradeport chains; buy is Sui-only per the user's explicit ask this session.
- **No origin chain/token picker for the ETH-origin Sui path** — hardcoded to
  Ethereum mainnet only, same V1-scope limitation the existing OpenSea
  cross-chain flow already has (queue item #3 there, still open).

---

## 2026-07-21b — Same-chain NFT purchase support + fee model decision (queue item #2)

Buyers who already hold ETH on Ethereum (the NFT's own chain) no longer have to route
through Solana+Relay to buy an OpenSea listing. Added a same-chain path alongside the
existing two-signature cross-chain flow:

- `app/api/nft/purchase/quote/route.ts`: detects `isSameChain = originChainId === the
  listing's own Relay dest chain id`. Same-chain skips `getRelayCallQuote` entirely
  (`relay_quote` persisted as `null`), is restricted to the chain's native currency only
  (no same-chain ERC20→ETH conversion — matches the existing "same-chain EVM-to-EVM
  swaps aren't supported yet" restriction elsewhere in this app), and computes USD
  volume via the new `getEthUsdPrice()`/`weiToUsd()` in `lib/pricing.ts` (CoinGecko)
  since there's no Relay quote to read a USD figure from.
- `app/api/nft/purchase/execute/route.ts`: branches on `quote.relay_quote === null`.
  Same-chain skips the Relay deposit-step build entirely and instead does the fresh
  `getOpenSeaBuyCall` staleness re-check immediately (the same re-check the cross-chain
  path only gets to do in `confirm-deposit`, after the bridging delay) and returns the
  buy call directly, jumping the purchase straight to `deposit_confirmed` — no deposit
  ever existed to confirm. `confirm-deposit` is simply never called for these; `confirm-
  buy` needed no changes since it already accepts starting from `deposit_confirmed`.
- **Fee decision**: same-chain purchases carry NO platform fee. The 0.25% cross-chain
  fee (via Relay's `appFees`) pays for the bridging/conversion service specifically —
  there's no such service on a same-chain purchase, so charging it anyway would just be
  a naked markup. Buyer pays exactly listing price + gas.
- `NftBuyModal.tsx`: added a "Pay with SOL" / "Pay with ETH" toggle (only shown when the
  listing's chain is one this app can also pay from directly — currently just Ethereum).
  Same-chain only requires the EVM wallet connected (no Solana wallet at all), and its
  `payAndBuySameChain()` skips straight from quote to `signAndBuy()` — one signature,
  no deposit-polling step in between.
- Gas estimation, receipt verification, and staleness-error classification are fully
  shared with the cross-chain path (`lib/chains/evm.ts`, `lib/nft/opensea.ts`) — no
  same-chain-specific duplication there.

Typecheck (`npx tsc --noEmit`) and `npm run lint` both pass clean. Not yet live-tested
with a real signed transaction (that's queue item #5, needs the user's own funded
wallet) — the quote/execute logic itself has been exercised via the same live-verified
`getOpenSeaBuyCall`/`estimateBuyCallTotalCostWei` functions the cross-chain path already
proved out live on 2026-07-20.

Next in the user's ordered queue: #3 origin chain/token picker for the buy flow.

---

## 2026-07-21 — Magic Eden total supply via Helius DAS (queue item #1)

Closes the "Listed/Total" and "Listed %" gap for Solana collections flagged since
2026-07-20i — Magic Eden's public API has no total-supply field, only `listedCount`.
Used Helius DAS (`getAssetsByGroup`), already available via the dedicated Helius RPC
key this app already pays for (`NEXT_PUBLIC_SOLANA_RPC_URL`) — no new credential.

**A real bug in the plan itself, caught by testing before implementing further**: the
earlier indexer-feasibility research (2026-07-20) claimed DAS's `total` field is "the
collection count." Tested live against Okay Bears (known ~10k supply) and got `total: 1`
with `limit: 1`, then `total: 1000` with `limit: 1000` — the field is bounded by
`limit`, not the real collection size, contradicting the research summary. Checked
Helius's actual docs instead of trusting the summary further: the real total requires
`options: { showGrandTotal: true }` (explicitly opt-in, "will make the request slower"
per their own docs) and comes back as a separate `grand_total` field. Confirmed live
with that param: `grand_total: 9858` for Okay Bears — matches the known real supply.

Also had to solve a real mapping gap: DAS needs the actual on-chain Metaplex collection
mint address, which has no relationship to Magic Eden's URL slug/symbol. Solved by
taking any real listing's mint (already available via `getMagicEdenListings`) and
calling DAS `getAsset` on it — its `grouping` array gives the real collection address
for free. A collection with zero active listings has no cheap way to resolve this;
surfaced honestly as `totalSupply: null`, not silently "—" with no explanation.

### What was built
- `lib/chains/heliusDas.ts` (new) — `getCollectionTotalSupply(sampleMint)`, two-layer
  cached (grouping lookup by sample mint, grand-total by resolved collection mint so
  different listings from the same collection share one cache entry).
- `app/api/nft/total-supply/route.ts` (new) — Magic Eden only (OpenSea already has
  `total_supply` on its collection response, no separate route needed there).
- `app/components/NftCollectionStats.tsx` — new `totalSupplyInfo` prop, same
  loading/override pattern as the existing `listedCountInfo` (OpenSea's listed-count
  equivalent from 2026-07-20l) — Magic Eden's Listed% can now actually compute, instead
  of permanently showing "—" since it previously had listedCount but no denominator.
- `app/nft/[vendor]/[slug]/page.tsx` — a new lazy-fetch effect mirroring the existing
  listed-count one exactly, fired independently of and after the main page load.

### Live-verified
`GET /api/nft/total-supply?vendor=magiceden&slug=okay_bears` → `{"totalSupply":9858}`
through the running app (not just the raw DAS call). Collection page confirmed still
rendering `200`. `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean.

---

## 2026-07-20p — Buy button wired up; user caught two real correctness gaps before ship

### UI wiring
- `app/components/NftBuyModal.tsx` (new) — the actual buy flow: connect both wallets
  (Solana pays, EVM receives + signs) → get quote → pay (sign the Relay deposit with
  the Solana wallet, reusing `buildRelayDepositTransaction`, the exact same helper the
  swap flow already uses) → poll `confirm-deposit` → sign the Seaport buy directly with
  the EVM wallet (reusing `useEvmWallet.ts`'s existing `sendStepAndWait`, no changes
  needed there — the `{to,value,data}` buy call slots into its existing `RelayEvmStep`
  shape with `from` filled in locally) → poll `confirm-buy` → done. V1 scope is
  deliberately narrow: origin is always native SOL from Solana (matches the exact path
  already live-validated in 2026-07-20o) — an arbitrary origin-chain/token picker is a
  real, larger follow-up, not built here.
- `app/nft/[vendor]/[slug]/page.tsx` — the "Coming soon" button is now a real "Buy" for
  `vendor === "opensea"` listings (opens the modal); Magic Eden/other-vendor listings
  keep the disabled placeholder, since buy-execution is OpenSea-only so far.
- One bug caught during writing, before it ever ran: an errant
  `setStep("idle") as unknown as null` inside JSX — calling setState synchronously
  during render. Removed the whole "connect" pseudo-step instead of patching around it
  with an effect; the wallet-connect UI now derives directly from `walletsReady`.

### Two real correctness gaps the user caught before this shipped — both fixed
User asked (mid-build): won't a buyer risk "insufficient funds" on step 2 since it's
now two separate transactions, and doesn't OpenSea already take its own fee — wouldn't
ours be a second, redundant charge?

1. **Real bug, would have broken every single purchase**: the quote only ever
   delivered the bare NFT price to the buyer's EVM wallet — step 2 (the actual Seaport
   buy) also needs ETH left over for gas, which the wallet would have had zero of.
   Fixed: `lib/chains/evm.ts`'s new `estimateBuyCallTotalCostWei()` estimates real gas
   for the actual buy call and adds a 1.5x safety margin (bridging can take real
   minutes, during which gas prices move) on top of the price, and the quote route now
   asks Relay to deliver that total instead of the bare price.
   - **Found and fixed a second bug while validating the first fix**: `estimateGas`
     against a real, empty EVM address (the honest quote-time state — funds haven't
     arrived yet) unconditionally rejects value-transferring calls
     ("total cost ... exceeds balance"). Fixed with a `stateOverride` that fakes a large
     balance for the estimation call only (confirmed live: same call goes from erroring
     to returning a real ~188k gas estimate) — doesn't touch anything on-chain.
   - **Found and fixed a third, unrelated bug while testing the second one**: viem's own
     built-in default mainnet RPC (`eth.merkle.io`) now 401s ("invalid key") with no
     `EVM_RPC_URL` configured — would have silently broken `lib/chains/evm.ts`
     entirely (not just gas estimation, also the on-chain buy-tx verification in
     `confirm-buy`). Fixed: explicit fallback to `https://ethereum.publicnode.com`,
     confirmed live working, instead of trusting viem's default.
2. **Not a bug, but real to address**: OpenSea's own marketplace fee (confirmed live
   against a real fulfillment response: exactly 1% of the listing price, paid to a
   second `additionalRecipients` entry) is already baked into the total price shown —
   a buyer pays this whichever way they buy, on OpenSea's own site or through us, so
   it's not something we're adding on top. Our 0.25% platform fee is for a genuinely
   different service (the cross-chain conversion/delivery), not a duplicate of
   OpenSea's fee. Made this explicit in the UI rather than leaving it implicit —
   `NftBuyModal.tsx` now shows a one-line breakdown under the quoted price.

### A fourth bug found live-testing the gas-buffer fix itself
Fetched a real listing, tried to quote it with a throwaway test EVM address
(deterministically derived from a well-known dummy private key) — got
`"This listing is no longer available"` for every single listing tried, which was
statistically implausible. Root-caused instead of accepting the error message at face
value: OpenSea's `fulfillment_data` endpoint returns the same HTTP 400 for "order not
found" (a real gone listing) AND for unrelated fulfiller-address rejections (confirmed
live: `"Account can not perform trading operations"` — almost certainly compliance
screening flagging the throwaway test key's on-chain history, not a real-wallet
concern). The code was blindly relabeling every non-ok response as "listing
unavailable," which would have shown a real buyer a misleading message if their own
wallet were ever rejected for an unrelated reason. Fixed: `getOpenSeaFulfillmentData`
now only throws `OpenSeaListingUnavailableError` when the message actually says
"order not found" (confirmed via a live test against a real nonexistent order hash);
any other error surfaces its real OpenSea text instead of a relabeled guess. Confirmed
fixed: the same real listing that returned 409 with the flagged test key correctly
returns 200 with a normal address (the well-known burn address, which has enough
on-chain history not to trip the same screening).

### Live-verified after all four fixes
Full quote flow re-run end-to-end with a real listing and a real (non-flagged) EVM
address: `200`, real fresh price, real gas-inclusive Relay quote (110.14 SOL total vs.
~109.11 SOL price-only from the pre-fix baseline — the ~1 SOL / ~$80 delta is a
plausible gas+fee amount at current gas prices, confirmed by back-of-envelope check
against the live-confirmed ~188k gas estimate). `npx tsc --noEmit`, `npm run lint`,
`npm run build` all pass clean.

### Not done yet
- Still no real wallet signature has ever been used — every check remains quote/
  build-only. First real transaction should be small.
- `listing_gone` has no dedicated visual treatment beyond a plain message in the modal.
- Fee breakdown in the UI is a single explanatory sentence, not itemized amounts.

---

## 2026-07-20o — NFT buy backend built, corrected to two-signature, live-validated end-to-end

### The one-signature design was found unsafe before any execution code was written
Deep research (user asked to "ultrathink") into how Relay's `call` primitive actually
executes confirmed a real fund-safety problem with the 2026-07-20n design: Relay's own
docs state destination calls execute via their Relayer/Multicaller contract, so
`msg.sender` during the call is **Relay's contract, not the buyer**. Separately
confirmed against Seaport's own documentation: **no Seaport fulfillment function (basic
or advanced) supports sending the offer item — the NFT — anywhere other than
`msg.sender`.** Combined: wrapping the OpenSea buy in Relay's `txs` would very likely
have sent the purchased NFT to Relay's contract, not the buyer, with no documented
sweep/recovery mechanism for NFTs (only ERC-20/native cleanup functions found). This was
caught at the research stage, before any signing/execution code existed — see the
research trail in the conversation for the specific docs quotes that confirmed it.

### Corrected architecture: two signatures, safer failure mode too
1. **Step 1**: Relay delivers ETH to the buyer's OWN EVM address (the plain,
   already-proven token-delivery pattern — `getRelayCallQuote` in `lib/chains/relay.ts`,
   `tradeType: EXACT_OUTPUT` on `/quote/v2`, deliberately with NO `txs` support — removed
   entirely, not left optional, specifically so a future call site can't fall into the
   same msg.sender trap without re-deriving this finding).
2. **Step 2**: that same wallet directly signs and submits the Seaport buy itself, so
   `msg.sender` is genuinely the buyer.
   Bonus safety property over the original design: if the listing sells out during step
   1's bridging delay, the buyer still has their ETH in their own wallet — no stuck
   funds, they just don't get that NFT. The new `listing_gone` status (migration 0006)
   makes this an explicit, handled outcome, not a silent loss.

### What was built
- **`supabase/migrations/0003-0006`**: `nft_purchase_quotes` + `nft_purchases` tables
  (separate from `swap_quotes`/`swap_transactions` — an NFT purchase binds to one
  specific listing that can vanish, not a fungible amount), `points_ledger` extended
  with `nft_purchase_id` + a new `nft_purchase_volume` reason, then migration 0006
  correcting the status flow and adding `order_hash`/`chain_slug`/`protocol_address`
  columns for the fresh re-fetch before step 2.
- **`lib/nft/opensea.ts`**: `getOpenSeaBuyCall()` — ABI-encodes a real Seaport
  `fulfillBasicOrder_efficient_6GL6yc` call from OpenSea's `fulfillment_data` response
  (which returns decomposed params + a `calldata_suffix`, not raw calldata — had to
  hand-encode via viem, cross-checked against 4byte.directory's independent signature
  database since the selector — `0x00000000` — is a deliberately gas-mined Seaport
  vanity selector and looked wrong before that check). `getOpenSeaFulfillmentData` is
  now ALWAYS a fresh call (never cached) — this doubles as the listing-staleness
  re-check: a sold/cancelled listing 404s/400s there, surfaced as a distinct
  `OpenSeaListingUnavailableError` rather than a generic thrown error.
- **`lib/chains/relay.ts`**: `getRelayCallQuote()` (see above — `txs`-free by design).
- **`lib/chains/evm.ts`** (new): server-side EVM RPC client (`EVM_RPC_URL`, defaults to
  viem's public RPC, same known limitation as the Solana side) — used to independently
  verify a client-reported buy-tx hash actually succeeded on-chain before crediting
  anything, same "never trust client-reported data" principle as the existing Relay
  settlement check in `/api/bridge/confirm`.
- **`lib/points.ts`**: `creditNftPurchasePoints()` — same shape as `creditSwapPoints`,
  kept as a separate function rather than a shared parameterized helper (Supabase's
  typed `.from()` calls don't parameterize cleanly across two differently-shaped
  tables, and the duplication is small and honest).
- **Four new API routes**, mirroring the existing quote/swap/bridge/bridge-confirm
  pattern: `POST /api/nft/purchase/quote` (re-fetches fresh price, gets the Relay
  delivery quote, persists — single-use, address-bound, same MITM-prevention shape as
  `swap_quotes`), `POST /api/nft/purchase/execute` (consumes the quote, builds step-1
  deposit steps), `POST /api/nft/purchase/confirm-deposit` (verifies against Relay's
  real settlement status, then — this is where the SECOND, authoritative staleness
  check happens — fetches a genuinely fresh buy call right before the buyer needs to
  sign it), `POST /api/nft/purchase/confirm-buy` (verifies the step-2 tx on-chain via
  `lib/chains/evm.ts` before crediting points).

### Live-verified end-to-end (real SIWS login, real listing, real Relay quotes — no funds moved, quote/build only, never signed/submitted)
Generated a real ed25519 keypair, completed a real SIWS challenge/verify login, fetched
a real active Pudgy Penguins listing, then drove the full quote→execute→confirm chain:
- `POST /api/nft/purchase/quote` → real `200`, real fresh OpenSea price (4.277 ETH),
  real Relay quote (109.11 SOL, ~$8,506), correctly persisted to `nft_purchase_quotes`
  (confirmed via direct DB query).
- `POST /api/nft/purchase/execute` → consumed the quote, created the `nft_purchases`
  row (`deposit_pending`), returned real Solana deposit instructions.
- `POST /api/nft/purchase/confirm-deposit` **before any real deposit was made** →
  correctly stayed `deposit_pending` (not a false positive — confirms this is a real
  Relay settlement check, not a rubber stamp).
- Re-using the already-consumed quote → correctly `400`s ("Quote not found, expired, or
  already used") — single-use enforcement and the race-guard both work.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean throughout.

### Not done yet
- **No UI wiring at all** — every buy button on the NFT pages is still the disabled
  "Coming soon" placeholder. This session validated and built the entire backend/data
  layer; connecting it to a real signing flow (EVM wallet connect on the NFT pages,
  which currently only exists on the swap page — see `app/components/AppHeader.tsx`'s
  comment on why EVM wallet state isn't shared yet) is the next concrete step.
- Never tested with a REAL wallet signature or REAL funds — every check above was
  quote/build-only. The first real signed transaction should be a small/cheap test
  purchase before this is trusted for arbitrary amounts.
- No handling yet for `listing_gone` in any UI (the state exists and is tested at the
  API level, but nothing user-facing surfaces it yet).

---

## 2026-07-20n — Relay `call` spike LIVE-VALIDATED: cross-chain OpenSea buy confirmed viable

User asked to build buy-from-OpenSea, chose the full cross-chain flow (pay from any
chain) over same-chain-only. That path was blocked on an open question since
2026-07-20 (the original spike): does Relay's `call`/`txs` primitive actually accept a
real third-party-built transaction (an OpenSea Seaport fulfillment) as its destination
call? That spike was docs-only — it needed a real OpenSea API key to generate a real
fulfillment tx to test with, which we now have (2026-07-20c).

### What was tested (live, real data, no funds moved — /quote only, never executed)
1. Fetched real `fulfillment_data` from OpenSea for an actual active Pudgy Penguins
   listing (token 5900, 4.277 ETH) via `POST /listings/fulfillment_data`.
2. OpenSea's response gives the call as **decomposed function name + struct params +
   a `calldata_suffix`**, not raw encoded calldata — a real gap: this had to be
   ABI-encoded by hand (viem `encodeFunctionData` against Seaport's
   `fulfillBasicOrder_efficient_6GL6yc` struct, matching field order from the
   response's `input_data.parameters`, then concatenating `calldata_suffix`).
3. **Did not trust the hand-encoding blindly** — Seaport's "_efficient_" function
   names are deliberately gas-mined vanity selectors (many leading zero bytes save
   calldata gas), so a selector that came out as `0x00000000` looked suspicious
   rather than obviously wrong. Cross-checked independently against 4byte.directory's
   public signature database for the exact text signature — confirmed `0x00000000`
   IS the real, correct selector for this function. Encoding trusted only after that
   independent confirmation.
4. Called `POST https://api.relay.link/quote/v2` with `originChainId=792703809`
   (Solana), `destinationChainId=1` (Ethereum), `destinationCurrency=0x00...00`
   (native ETH), `tradeType=EXACT_OUTPUT`, `amount` = the exact wei price, and `txs`
   = the encoded OpenSea fulfillment call. **Relay returned a complete, valid quote**:
   a real Solana deposit instruction, a `requestId`, fee breakdown, and — critically —
   `details.currencyOut.amount` came back as **exactly** `4277000000000000000` (4.277
   ETH, precisely the OpenSea listing price), with `currencyIn` computed as ~108.78
   SOL (~$8,433) to cover it. Relay understood and correctly priced the wrapped
   third-party call.

### Conclusion — architecture confirmed
The single-intent cross-chain buy (pay in SOL/any origin token, buy an ETH-priced
OpenSea NFT, deliver to a specified address, all from one signed origin-chain deposit)
is **real and technically viable**, not just a docs claim. This resolves the open
question blocking `PLAN.md`'s NFT buy-execution phase for EVM destinations.

### Not done yet (this was a quote-only spike, no execution)
- Never called `/execute` or signed/submitted anything — no funds moved, no NFT
  bought. The quote proves feasibility, not that the full flow works end-to-end
  through actual signing and settlement.
- No re-encoding utility exists in the codebase yet — the ABI encoding above was a
  one-off Node script (deleted after the spike, not committed). Needs a real,
  reusable `lib/nft/openseaFulfillment.ts`-style module before any UI can use it.
- Listing-staleness handling (a listing can be sold/cancelled between quote and
  execution — flagged as an open risk since the very first NFT research pass) is
  still unaddressed — needs a re-check-immediately-before-execute step.
- No DB state machine for NFT purchases exists — `swap_transactions` covers
  fungible-token swaps only. An NFT buy has a different failure surface (a specific
  listing, not a fungible amount) and likely needs its own tracking table.

---

## 2026-07-20m — Real floor price (not OpenSea's stale stats field) + traits collapsed by default

User reported the displayed Floor Price didn't match the cheapest asset actually visible
in the collection. Root-caused, not assumed:

1. **Real bug**: the listings grid had no sort order at all — the actual cheapest item
   often wasn't even on the first page a user would see, making the stats-bar floor
   price look disconnected from what was visibly browsable. Fixed: `getOpenSeaListings`
   now requests `order_by=unit_price` (confirmed live, ascending) — the grid always
   shows cheapest-first now.
2. **Real OpenSea data discrepancy, not our bug**: even after sorting, the true cheapest
   fetchable listing (4.277 ETH) still didn't match OpenSea's own `/stats` `floor_price`
   field (4.14999999999999 ETH) — confirmed by scanning 100 listings sorted ascending
   and finding nothing near 4.15. This is OpenSea's stats endpoint lagging reality (a
   sold/cancelled listing, most likely), not something wrong on our end.

Fixed by computing floor price ourselves instead of trusting `/stats`: `lib/nft/
opensea.ts`'s `countOpenSeaListedItems` (already scanning listings for the count
feature, see 2026-07-20l) now also captures the first item's price on its first
`order_by=unit_price`-sorted page as the true floor — free, since that scan was already
happening. `OpenSeaListedCount` gained `floorPrice`/`floorPriceCurrency`.
`NftCollectionStats.tsx` now prefers this computed floor over `collection.floorPrice`
(OpenSea's stats) when available, with a tooltip explaining the two can disagree.
Magic Eden's floor price is untouched — no discrepancy found there.

Also: `NftTraitFilters.tsx`'s trait groups now default to **collapsed** (was expanded)
per explicit request — a collection with a dozen+ trait types was pushing the listings
grid far down the page on first load.

Live-verified after restarting the dev server to clear the (correctly-behaving, just
stale-from-before-the-fix) 10-minute cache: `GET /api/nft/listed-count?vendor=opensea&
slug=pudgypenguins` → `floorPrice:"4.277"` (was silently using OpenSea's mismatched
4.15 before). `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean; both
`/nft` and the collection detail page confirmed still rendering `200` after restart.

---

## 2026-07-20l — Real Listed count for OpenSea collections (computed, not "—")

User asked to actually compute Listed/Total for the Pudgy-Penguins-style case instead
of leaving it "—". OpenSea's API has no total-active-listings field anywhere (already
confirmed via full response greps in 2026-07-20j) — so it has to be computed by
paginating their listings endpoint ourselves and counting.

### What changed
- `lib/nft/opensea.ts` — new `countOpenSeaListedItems(slug)`: paginates the *raw*
  listings endpoint (no per-NFT metadata enrichment — we only need identifiers here,
  ~5-10x cheaper per page than the buy-grid fetch) at `limit=100`, counting **unique
  token identifiers**, not raw listing entries — deliberately, because the same token
  can have more than one simultaneous active order (the exact #8713 bug from
  2026-07-20k would have overcounted by 1 per duplicate if counted naively). Capped at
  20 pages (2000 unique tokens) before giving up and marking the result
  `approximate: true` — bounds worst-case cost (up to 20 sequential calls against the
  60-reads/min key) for a single stat on a highly liquid collection. Cached 10 minutes.
- `app/api/nft/listed-count/route.ts` (new) — deliberately a *separate* route from
  `/api/nft/collection`, with its own tighter rate limit (20/min instead of 60, since
  each call can itself cost up to 20 upstream calls). 400s for non-OpenSea vendors
  (Magic Eden already gets listedCount for free on its `/stats` call — no separate
  computation needed there).
- `app/components/NftCollectionStats.tsx` — takes an optional `listedCountInfo` prop
  that overrides `collection.listedCount` when present, with a `loading`/`approximate`
  state ("counting…" while in flight, "≈" prefix if the 2000-token cap was hit).
- `app/nft/[vendor]/[slug]/page.tsx` — fires the listed-count fetch in its own
  `useEffect`, independent of and after the main collection/listings load, so a slow
  first-time count (real cost, real API calls) never blocks the page from rendering —
  the stat just shows "counting…" and fills in once ready.

### Live-verified
`GET /api/nft/listed-count?vendor=opensea&slug=pudgypenguins` → `{"count":113,
"approximate":false}` — real, first call took 652ms (computed live, this collection
converged within ~2 pages), second call 7ms (served from the 10-minute cache, confirmed
by server log timestamps). 113/8888 = 1.27%, a plausible real number for this
collection's actual liquidity. `npx tsc --noEmit`, `npm run lint`, `npm run build` all
pass clean.

### Not done
- Magic Eden's side of "Listed/Total" is still "—" — it has the opposite gap
  (listedCount but no totalSupply), and no confirmed total-supply endpoint was found
  after real investigation in 2026-07-20i. Not revisited this pass.

---

## 2026-07-20k — Duplicate NFT cards fixed (root-caused, not just deduped blindly)

User reported Pudgy Penguin #8713 appearing twice in the listings grid at the same
price (4.752 ETH). Root-caused before fixing, not assumed:

Fetched the raw listings response directly and found the duplication is **real
OpenSea data, not a fetch/pagination bug on our side** — confirmed by diffing token
IDs across two live pages: several tokens (`5900`, `8713`, `7002`, ...) appear twice
*within a single page response* from OpenSea's own `/listings/collection/{slug}/all`.
Pulled the two `#8713` entries specifically: same seller, same price
(`4.752222222222223` ETH — matches the user's rounded `4.752`), but two genuinely
different Seaport `order_hash` values. The same seller has two separate active orders
on the same NFT — a real, if confusing, marketplace state, not an artifact of our
polling/dedup logic. (Also confirmed the milder, expected case: a token can legitimately
appear again on the *next* cursor page if the live order book shifts between fetches.)

Still bad UX regardless of cause — a buyer can only buy the NFT once, so showing it
twice is confusing. Fixed at the presentation layer: `app/nft/[vendor]/[slug]/
page.tsx` gained `dedupeListings()`, collapsing to the cheapest listed price per
`vendor-tokenId` (applied both on initial load and on each infinite-scroll page
append, so it also cleans up the cross-page duplicate case). An accompanying code
comment documents the real cause so a future session doesn't waste time re-diagnosing
it as a fetch bug.

Live-verified: `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean; dev
server confirmed up and the user's own browser reloaded the page cleanly afterward
(visible in server logs, no compile/runtime errors).

---

## 2026-07-20j — Price formatting fixes + honest tooltip on missing stats

User reported floor price showing raw floating-point noise (`4.14999999999999 ETH`)
and asked for floor price at 2 decimals, per-asset listing price at 3 decimals. Also
flagged Listed/Total and Listed% both showing "—" as "some data not showing."

Re-verified live (again) that OpenSea's `/stats` and base collection-detail responses
genuinely have no active-listings-count field anywhere — grepped the full JSON for
`listing|listed|active|count`, only hit is `unique_item_count` (= total supply, not
listed count) and an unrelated `listing_currency` field. Confirmed this is a real API
gap, not a bug: Magic Eden gives listed count but not total supply; OpenSea gives total
supply but not listed count — see 2026-07-20i. Fixed the *presentation* of that gap
instead: `NftCollectionStats.tsx`'s Listed/Total and Listed% cells now carry a `title`
tooltip explaining *why* per vendor ("OpenSea's public API doesn't expose a total
active-listings count" / "Magic Eden's public API doesn't expose total supply..."),
rather than a bare unexplained "—".

Fixed: `app/components/NftCollectionStats.tsx` floor price → `Number(...).toFixed(2)`.
`app/nft/[vendor]/[slug]/page.tsx` per-listing price → `Number(l.price).toFixed(3)`.
`app/nft/page.tsx` browse-grid floor price → `Number(...).toFixed(2)` (same fix,
consistency — wasn't explicitly asked but was the identical bug in the other place
floor price renders).

Live-verified: `npx tsc --noEmit`, `npm run lint` clean; dev server confirmed up and
serving both pages after the change.

---

## 2026-07-20i — Infinite scroll, All-items browsing, collection stats bar

User asked for: unlisted items alongside listed ones, "limit per scroll" (pagination
instead of a flat fetch), and a stats row (total assets, listed/total, listed %, 24hr
volume, floor price, 24hr % change) below the collection header.

### Data layer
- `lib/nft/types.ts` — `NftCollection` gained `totalSupply`, `volume24hr(Currency)`,
  `numOwners`. `NftListing` gained `listed: boolean`, and `price`/`priceCurrency`/
  `seller`/`raw` all became optional (an unlisted asset has no order to describe).
  Fields are explicitly NOT symmetric across vendors — documented inline rather than
  papered over, since Magic Eden and OpenSea simply expose different stats:
  - **Magic Eden**: `listedCount` (from `/stats`) — confirmed real. No `totalSupply`
    field found in the public API after checking collection detail, stats, and
    holder-stats-style paths; several 404'd/didn't exist. Left undefined, not guessed.
  - **OpenSea**: `total_supply` IS on the base collection-detail response (confirmed
    live — it's nested under a field most of the earlier tooling hadn't dug into),
    `floor_price`/`num_owners`/one-day `volume` are on `/stats` (a separate call, added
    to `getOpenSeaCollection`'s existing `Promise.all`). No cheap `listedCount` —
    the listings endpoint returns only a page + cursor, no total count field.
  - **24hr floor-price % change**: not exposed by either vendor's researched public
    API. Rendered as a permanent "—" in the UI rather than computed/estimated —
    see `NftCollectionStats.tsx`'s comment.
- `lib/nft/opensea.ts` — `getOpenSeaListings` and the new `getOpenSeaAllAssets` both
  now cursor-paginated (`OpenSeaPage { listings, nextCursor }`). `getOpenSeaAllAssets`
  hits `/collection/{slug}/nfts` — confirmed live to return full collection inventory
  regardless of listing status, with name/image/traits inline (cheaper per-item than
  the listings path, which needs a separate per-NFT metadata call). Every item from
  this endpoint comes back `listed: false` — it carries no order data, and is NOT
  cross-referenced against a real listings page to guess which happen to also be for
  sale (that would cost another API call per page; left honestly unlisted instead).
- `lib/nft/magiceden.ts` — listings marked `listed: true` (the endpoint only ever
  returns currently-listed items); pagination already existed via `offset`/`limit`.
- `app/api/nft/listings/route.ts` — rewritten for pagination: `view=listed|all` +
  `cursor` params. Magic Eden's cursor is just the numeric offset as a string; OpenSea's
  is its own opaque `next` token, passed straight through. `view=all` for Magic Eden/
  Tradeport (neither has a confirmed all-items endpoint) falls back to listed-only
  rather than erroring — the UI hides the All-items toggle for those vendors instead of
  relying on a server-side 400.

### UI
- `app/components/NftCollectionStats.tsx` (new) — the 6-stat row (Total Assets,
  Listed/Total, Listed %, Floor Price, 24hr Volume, 24hr Change), every value real
  vendor data or an honest "—", placed directly below the collection header card.
- `app/nft/[vendor]/[slug]/page.tsx` — added a Listed/All toggle (OpenSea only, tab
  hidden for other vendors) and real infinite scroll: an `IntersectionObserver` on a
  sentinel div triggers loading the next cursor page and appending to the grid, instead
  of a single fixed 20-item fetch. Unlisted cards ("All items" view) show "Not listed"
  instead of a price/buy button. Search and trait-filter state now reset independently
  of the Listed/All toggle (switching views shouldn't silently discard an in-progress
  filter) — required wrapping that reset in a microtask to satisfy the same
  `set-state-in-effect` lint rule hit twice already this session (2026-07-20d/i).

### Live-verified (real requests against the running app, plus real concurrent user traffic)
- `GET /api/nft/collection?vendor=opensea&slug=pudgypenguins` → real `totalSupply:8888`,
  `floorPrice:"4.15"`, `volume24hr`, `numOwners` all populated.
- `GET /api/nft/listings?...&view=listed` → 20 items + real `nextCursor`; passing that
  cursor back returns a genuinely different page 2.
- `GET /api/nft/listings?...&view=all` → 20 items, `listed:false`, real traits present
  (confirms the cheaper per-item metadata path works).
- Magic Eden: `GET /api/nft/listings?vendor=magiceden&slug=okay_bears&view=listed` →
  `nextCursor:"20"` (offset-based), confirms cross-vendor cursor handling both work
  through the one route.
- The user was actively using the page throughout (visible in server logs — toggling
  Listed/All, scrolling to trigger more pages) with zero errors.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean.

### Not done
- No "All items" support for Magic Eden (Solana) or Tradeport — no confirmed
  full-inventory endpoint found in either public API after real investigation, not
  simply unresearched. Revisit if either vendor's docs/access improves.
- OpenSea's "All items" view doesn't cross-reference active listings, so it can't show
  which unlisted-looking items are actually for sale via other means — see
  `getOpenSeaAllAssets`'s comment.
- No mobile trait-filter drawer still (pre-existing gap, unchanged this pass).

---

## 2026-07-20h — Trait filters + search inside collections, real chain logos

### Trait filters + search
Discovered live that both marketplace APIs already carry trait/attribute data we
weren't using: Magic Eden's listings endpoint embeds a full `token.attributes` array
(and `token.name`/`token.image`) directly in each listing — confirmed against a real
`okay_bears` listing, no extra call needed. OpenSea's per-NFT metadata call (already
being made for image/name, see 2026-07-20d) also returns `traits` — confirmed against a
real `pudgypenguins` listing. Both wired through:
- `lib/nft/types.ts` — new `NftTrait { traitType, value }`, `NftListing.traits?`.
- `lib/nft/magiceden.ts` — `getMagicEdenListings` now reads `l.token.attributes` (plus
  `l.token.name`, preferring it over the old `extra.img`-only image source).
- `lib/nft/opensea.ts` — `getOpenSeaNftMetadata`/`getOpenSeaListings` now also carry
  `traits` from the metadata response already being fetched.
- `app/components/NftTraitFilters.tsx` (new) — derives available trait types/values
  (with counts) from whatever listings are currently loaded, renders collapsible
  checkbox groups, OR's within a trait type / AND's across trait types (standard
  marketplace filter convention). Explicitly scoped as a filter over the loaded batch,
  not a full-collection trait index — no vendor exposes a lightweight "all trait values"
  endpoint separate from listings, and bumping the listings page size to get more trait
  coverage isn't free: OpenSea's per-NFT metadata enrichment means each additional
  listing costs one more API call against the 60-reads/min agent key (see 2026-07-20c) —
  left the fetch limit at 20 rather than risk exhausting it on page load.
- `app/nft/[vendor]/[slug]/page.tsx` — added a search input (filters by name/token ID,
  client-side over the loaded batch) and a two-column layout (trait sidebar + listings
  grid, sidebar hidden below `md` for now — no mobile filter drawer yet). Both search
  and trait state reset when navigating to a different collection.

### Chain-tab logos replace the color dots
User asked for real logos instead of the brand-color dots added in 2026-07-20g.
Solana/Ethereum use Relay's own hosted icon assets (`assets.relay.link/icons/{chainId}/
light.png`) — the exact same source this app already uses for every other chain icon
via `lib/chains/relayChains.ts`, confirmed live (both URLs return `200`) rather than
guessed. Relay doesn't cover Sui, so the disabled SUI tab keeps a plain inline SVG glyph
instead of a fabricated logo URL. `lib/nft/labels.ts`'s `NFT_CHAIN_FAMILIES` now carries
`iconUrl: string | null` instead of `dot: string`.

### Live-verified
`GET /api/nft/listings?vendor=opensea&slug=pudgypenguins` and `...vendor=magiceden&
slug=okay_bears` both confirmed returning real trait arrays through the running app
(not just the raw vendor APIs). Chain logos confirmed present in `/nft`'s rendered HTML.
`npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean.

### Not done
- No mobile layout for the trait sidebar yet (hidden below `md`, no toggle/drawer).
- Search/filtering only covers the currently-loaded listings batch (up to 20), not the
  full collection — a real "search the whole collection" feature needs server-side
  query support per vendor, which neither API's listings endpoint offers directly.

---

## 2026-07-20g — Full visual design pass: real token system, both themes

User asked for a genuine visual upgrade ("let's make this look awesome"), not just more
components. Loaded the `artifact-design` skill for design fundamentals (color-as-tokens,
type pairing, avoid generic AI-design defaults) and adapted them to a real Next.js app
rather than a one-off page.

### Design plan
- **Color** — "trading terminal calm": one confident accent (electric indigo-violet,
  `#5B4FE8` light / `#8B7FFF` dark), hairline-bordered surfaces on a softly violet-tinted
  canvas, semantic success/danger kept separate from the accent. 6 named tokens:
  canvas, surface, ink, ink-muted, accent, hairline (+success/danger).
  Chain-family badges use each chain's own real brand color (Solana teal-green
  `#14F195`, Ethereum indigo-blue `#627EEA`) as a small identity dot — recognizable the
  way block explorers already color-code chains, not an arbitrary decorative choice.
- **Type** — Geist Sans for UI/headings (already loaded, unchanged), Geist Mono
  reserved specifically for anything numeric — prices, token amounts, wallet addresses,
  swap IDs (`.num` utility class, `font-variant-numeric: tabular-nums`). Deliberate,
  not generic mono-everywhere: wallet addresses and token amounts are conventionally
  monospaced across this entire product category (explorers, wallets), so it reads as
  "crypto-native," not decorative.
- **Layout** — hairline-bordered cards with soft shadow, restrained rounded corners
  (dialed back the earlier overuse of `rounded-full`), tasteful hover states (lift +
  border tint on cards, brightness on primary buttons), loading skeletons instead of
  plain "Loading…" text, `prefers-reduced-motion` respected globally.

### A real bug found and fixed while building this
`app/globals.css` had `font-family: Arial, Helvetica, sans-serif;` hardcoded on `body`
— left over from the default `create-next-app` scaffold and never removed. This
silently overrode the Geist Sans variable the whole app had been loading via
`next/font/google` since day one (2026-07-17): **the entire app has never actually
rendered in Geist**, it's been rendering in Arial this whole time. Fixed as part of the
token-system rewrite (`body { font-family: var(--font-sans), ... }`).

### What changed
- `app/globals.css` — full rewrite: CSS custom-property token system (`:root` +
  `@media (prefers-color-scheme: dark)` redefinition, mapped into Tailwind v4 via
  `@theme inline` so components use plain utilities like `bg-canvas`/`text-ink`/
  `border-hairline`/`bg-accent`). Both light and dark fully designed, not just the
  dark mode default inverted — contrast and the accent's legibility checked in both
  (light-mode accent `#5B4FE8`, dark-mode brightened to `#8B7FFF` since the same hex
  reads muddy against a near-black ground). Focus-visible ring added globally
  (previously nothing had one). Wallet-adapter's default purple button (`#512da8`,
  ships no theme prop) re-themed via its class names to match the accent.
- `app/components/AppHeader.tsx` — small inline SVG wordmark (a swap/exchange glyph)
  replacing plain text, nav pills restyled with the token system.
- `app/components/Breadcrumb.tsx`, `NftChainTabs.tsx` — restyled; chain tabs gained the
  brand-color identity dots described above.
- `app/components/NftImage.tsx` — placeholder emoji (🖼️) replaced with an inline SVG
  image glyph; added a real loading shimmer (pulse) that resolves to the actual image
  fading in, instead of the image just popping in with no loading state at all.
- `app/components/TrendingBar.tsx` — 🔥 emoji marker replaced with a small inline SVG
  trend-line icon (the design skill flags emoji-as-section-markers as a generic-AI-design
  tell; also more fitting the trading-terminal vernacular than a fire emoji).
- `app/nft/page.tsx`, `app/nft/[vendor]/[slug]/page.tsx` — collection/listing grids
  redesigned: skeleton loading states (was plain "Loading…" text), styled empty/error
  states (was plain gray text), hover-lift cards, prices in `.num` mono with the
  currency de-emphasized, vendor badge pill on the collection header.
- `app/page.tsx` (swap) — sell/buy amount inputs now `.num` mono (a financial input
  should never proportionally-space digits), swap button restyled as the primary
  accent CTA, message banner color now reflects state (danger/success/neutral) instead
  of always plain gray text, bridge-steps debug JSON block restyled to match.
- `app/components/SwapPanel.tsx`, `TokenSelectModal.tsx`, `EvmWalletButton.tsx` — full
  token-system pass (was hardcoded `indigo-*`/`gray-*` throughout); token/chain picker
  modal backdrop got a blur; flip button gained a hover micro-interaction (180° rotate).
- `app/dashboard/page.tsx` — was visually a completely different, unstyled page (plain
  `border`, no rounded corners, black button) — brought in line with the rest of the
  app's card/token system. Points balance and invite code now use `.num` mono.
- `lib/nft/labels.ts` — added the `dot` brand-color field to `NFT_CHAIN_FAMILIES`
  (single source of truth, same file as the label/vendor-mapping additions from
  2026-07-20f).

### Live-verified
`npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean. The user was
actively browsing the dev server throughout this pass (visible in server logs — real
requests to `/`, `/nft`, `/nft?family=evm`, and several real OpenSea collection pages
including pudgypenguins, azuki, and others) with zero compile or runtime errors across
every hot-reload during the whole redesign. Not independently screenshotted (no browser
automation available this session) — the user's own live traffic during the edits is
the closest thing to real-browser verification available here.

### Not done
- No manual light/dark theme toggle exists in the UI — dark mode is automatic via
  `prefers-color-scheme` only, per the design skill's guidance that a real in-app toggle
  needs its own `data-theme` override mechanism, which this app doesn't have yet. Add one
  if the user wants manual control rather than following the OS.
- `TokenIcon.tsx`'s fallback-avatar `PALETTE` was left untouched (deliberately — those
  are decorative per-token identicon colors, unrelated to the UI chrome token system).

---

## 2026-07-20f — Shared header + chain tabs + breadcrumb navigation, site-wide

User feedback after using it live: every page needs a consistent header (brand +
Swap/NFTs nav), and the NFT section specifically needs a persistent "which chain am I
looking at" indicator plus a clickable breadcrumb trail (e.g. "NFTs > Ethereum > Pudgy
Penguins") for orientation.

### What changed
- `app/components/AppHeader.tsx` (new) — shared top bar: brand link, Swap/NFTs nav
  (active-state highlighted via `usePathname`), and the Solana wallet connect button.
  Now used on `/`, `/nft`, `/nft/[vendor]/[slug]`, and `/dashboard` — replaces four
  separate ad-hoc headers. EVM wallet connect (`EvmWalletButton`) deliberately stays
  swap-page-only: its hook is local `useState`, not a shared context like the Solana
  wallet provider, so centralizing it here would silently create a second, disconnected
  EVM connection state from the one `runSwap()` actually signs with. Revisit only once
  a real EVM wallet context exists (relevant once NFT buy-execution needs EVM signing).
- `app/components/NftChainTabs.tsx` (new) — the chain-family tab strip (Solana /
  Ethereum / SUI (Upcoming)), refactored from local-state buttons (only usable on the
  browse page) into plain links driven by a `?family=` URL param, so the exact same
  component renders correctly on both the browse page (active = selected tab) and the
  collection detail page (active = that collection's own chain family, no selection
  state needed there).
- `app/components/Breadcrumb.tsx` (new) — generic `{label, href?}` trail renderer.
- `lib/nft/labels.ts` (new) — single source of truth for chain-family display labels
  and vendor→family mapping (`magiceden→solana`, `opensea→evm`, `tradeport→move`), so
  the tabs and breadcrumb never drift out of sync with each other or with `lib/nft/
  types.ts`'s `NftChainFamily` union.
- `app/nft/page.tsx` — tab state moved from local `useState` to the URL (`?family=`),
  wrapped in `<Suspense>` per Next's requirement for `useSearchParams()` in a
  statically-rendered page (confirmed still prerenders as `○ Static` after the change).
- `app/nft/[vendor]/[slug]/page.tsx` — derives its chain family from the `vendor` route
  param (via `nftFamilyForVendor`) rather than waiting on the collection fetch, so
  tabs/breadcrumb render immediately instead of flashing in after data loads.
- `app/page.tsx` (swap) and `app/dashboard/page.tsx` — swapped their own inline headers
  for `<AppHeader />`; removed the now-dead local `WalletMultiButton` dynamic-import
  block from `app/page.tsx` (moved into `AppHeader`).

### Live-verified (real requests against the running dev server)
`GET /`, `/nft`, `/nft?family=evm`, `/nft/opensea/pudgypenguins`, `/dashboard` all
return `200`. Rendered HTML confirmed to contain the brand name, both nav labels, all
three chain-tab labels ("Solana", "Ethereum", "SUI (Upcoming)"), and "NFTs" breadcrumb
segment. `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean; `/nft`
still prerenders statically despite now using `useSearchParams()`.

**Not done**: no real-browser visual QA (same limitation as 2026-07-20d/e — no browser
automation available this session, verified via curl + dev-server logs only).

---

## 2026-07-20e — Two real bugs from the user's first live click-through, fixed

User loaded the NFT section from another device on the LAN and reported "NFTs section
not loading, also button from Ethereum EVM not working." Root-caused both against the
actual running dev server (not guessed):

1. **LAN access blocked the dev server's HMR websocket** — Next.js 16 blocks
   cross-origin dev-resource requests by default; the dev log showed "Blocked
   cross-origin request to Next.js dev resource /_next/webpack-hmr from
   192.168.100.200" every time the user's device (a different machine than the Pi
   running the server) loaded a page. Fixed: added `allowedDevOrigins:
   ["192.168.100.200"]` to `next.config.ts`. This only matters for local dev (`npm run
   dev`); irrelevant once deployed.
2. **EVM tab returned real but useless data** — `browseOpenSeaCollections` had no
   `chain` or `order_by` params, so OpenSea's default collection ordering returned
   essentially arbitrary/spam results: raw contract addresses as names, null images,
   wrong chains (avalanche collections showing under an "Ethereum & EVM" tab).
   Technically a `200` with real JSON, so it "worked" by every check I'd run earlier,
   but was visibly broken to a human looking at it — a class of bug pure API-status
   verification misses. Root-caused live: tried several `order_by` candidates against
   the real API (`total_volume` and `num_owners` both 400 as unsupported/removed;
   `seven_day_volume` works and returns real collections — CryptoPunks, Pudgy
   Penguins, etc). Fixed: `browseOpenSeaCollections` now defaults to
   `chain="ethereum"` + `order_by="seven_day_volume"`.

Also hit Magic Eden's rate limit again organically while testing (`clayno_watch_
collect_portrait` 429'd) — confirmed via the raw API directly that this is a real,
ongoing rate-limit from cumulative testing today, not a new bug; the 429-vs-404 fix
from 2026-07-20d is working correctly (surfaces the real 429 instead of a fake
"not found"). Stopped polling it further to let the limit cool down naturally.

**Live-verified after fixes**: `GET /api/nft/collections?chainFamily=evm` now returns
CryptoPunks/Pudgy Penguins with real images instead of unnamed contract addresses.
`npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean.

**Lesson**: a `200` + parseable JSON is not the same as "the feature works" — this is
the second time this session real breakage hid behind a technically-successful response
(see 2026-07-20d's OpenSea listings crash and ME 429-as-404 bugs). For anything with
meaningful default/sort behavior, look at what the data actually *is*, not just whether
the call succeeded.

---

## 2026-07-20d — First NFT browse UI: collection grid + collection/listings page

**Status: real, working UI for Solana (Magic Eden) and EVM (OpenSea) browse + listings,
live-verified against the running dev server with actual data. Buy is a disabled
placeholder button (no buy-execution code exists yet). Move/Tradeport tab shown but
disabled — blocked on `TRADEPORT_API_KEY`, not obtained yet.**

### What was built
- `app/components/NftImage.tsx` — `<img>` with graceful fallback (🖼️ placeholder),
  same pattern as `app/components/TokenIcon.tsx`'s failed-load handling.
- `app/nft/page.tsx` — browse page: three chain-family tabs (Solana / EVM / Sui-Aptos),
  Move tab disabled with a "(soon)" label rather than hidden, matches the "don't
  silently drop deferred scope" instinct already applied to TON/Bitcoin in PLAN.md.
  Grid of collection cards (image, name, floor price when the vendor provides one),
  linking to `/nft/[vendor]/[slug]`.
- `app/nft/[vendor]/[slug]/page.tsx` — collection detail: header (image, name,
  vendor/chain-family, description) + a grid of active listings (image, name or
  truncated token id, price). Every listing card has a disabled "BUY — COMING SOON"
  button with a tooltip pointing at PLAN.md — buy-execution isn't built yet, this is
  browse-only.
- `app/api/nft/collection/route.ts` and `app/api/nft/listings/route.ts` — new
  query-param-based routes (`?vendor=&slug=`) feeding the detail page, same rate-limit
  pattern as the existing collections browse route.
- Added a "NFTs" link in the main swap page header (`app/page.tsx`).

### Two real bugs found and fixed during live verification
1. **OpenSea listing schema was wrong** — `getOpenSeaListings` assumed a top-level
   `maker.address` field and used `order_hash` as the NFT's `tokenId`. The real response
   (confirmed via a live authenticated call) has neither — seller is
   `protocol_data.parameters.offerer`, and the actual NFT identity is
   `asset.identifier`/`asset.contract`. This crashed every listings request
   ("Cannot read properties of undefined (reading 'address')") until fixed. Caught by
   actually clicking through to a collection page and hitting a real API error, not by
   typecheck (the field was typed as required, so TS trusted the wrong shape).
2. **Magic Eden 429 (rate limit) was being silently reported as "collection not
   found"** — `getMagicEdenCollection` treated any non-ok status from the collection-
   detail fetch as "doesn't exist" and returned `undefined`. ME's keyless rate limit
   (~120 req/min, confirmed low in practice — this session hit it repeatedly just from
   normal-looking testing) means a real, existing collection can 429 under load and get
   misreported as missing. Fixed: only a literal `404` returns `undefined` now; every
   other non-ok status throws with the real HTTP code, surfaced to the UI instead of
   masquerading as "not found." Confirmed live: after the fix, a rate-limited request
   correctly returned `"Magic Eden collection lookup failed (429)"` instead of a 404.

### Live-verified (real requests against the running dev server)
- `GET /nft` → 200, renders the browse shell.
- `GET /nft/opensea/boredapeyachtclub` → 200, renders the detail shell.
- `GET /api/nft/collections?chainFamily=solana` → real Magic Eden collections.
- `GET /api/nft/collection?vendor=opensea&slug=boredapeyachtclub` → real OpenSea
  collection data (uses the instant agent key from 2026-07-20c).
- `GET /api/nft/listings?vendor=opensea&slug=boredapeyachtclub` → real Seaport listing
  data, correct price/seller/tokenId after the bug fix above.
- `GET /api/nft/listings?vendor=magiceden&slug=...` → `{"listings":[]}` for a
  currently-unlisted collection (correct, not an error).
- The 429-vs-404 fix confirmed live (see bug #2 above).
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean throughout.
- **Not done**: no real-browser visual QA (no browser automation available in this
  session) — verified via curl + dev server logs only, not eyeballed in an actual
  browser. Do a real visual pass before considering this "done" done.

### Not done yet
- No buy-execution UI or wiring — every buy button is a disabled placeholder.
- Move/Tradeport browse tab is disabled — blocked on `TRADEPORT_API_KEY` (see
  2026-07-20b/c).
- No wallet-aware behavior on these pages yet (e.g. showing "connect wallet to buy"
  contextually) — buttons are unconditionally disabled regardless of connection state,
  since there's nothing to connect them to yet.
- Went a bit heavy on Magic Eden's keyless rate limit during this session's live
  testing (multiple 429s) — worth being more conservative about test call volume against
  their public endpoints going forward; they're generously keyless but not high-limit.

---

## 2026-07-20c — OpenSea API key obtained (instant, no signup) + live end-to-end verify

**Status: OpenSea is now fully live and working end to end for collection browse and
listings, real key in `.env.local`. Magic Eden and Tradeport still blocked on
account-creation steps that need the user's own identity — see below.**

Found OpenSea has an **instant, anonymous, no-signup key-issuance endpoint** built
specifically for agent/script use: `POST https://api.opensea.io/api/v2/auth/keys` with
an empty body returns a real key immediately — no email, no account, no approval.
Obtained one live 2026-07-20 (`88bf1cb5712998db2c42751afd17d217`, expires
2026-08-19, rate limits 60 reads/min / 5 writes/min / 5 fulfillment/min — the
free/agent tier, lower than an account-based key but real). Added to `.env.local`.

**Live-verified with the real key** against the running app (not just raw curl):
`GET /api/nft/collections?chainFamily=evm` and `...&chain=ethereum` both return real
OpenSea collection data end to end through `browseOpenSeaCollections()`. Direct curl
also confirmed the same key works against `/listings/collection/.../all` (real Seaport
order data returned).

**Checked whether Magic Eden or Tradeport have an equivalent anonymous/instant key
mechanism — confirmed neither does:**
- Magic Eden: `POST /v2/auth/keys` doesn't exist (404 "Not Found"); docs confirm keys
  require a dashboard-login account, no agent/instant path documented.
- Tradeport: key issuance is exclusively via an Asana form requiring contact/business
  info (already known from Phase 1 research).

**Not done — needs the user directly**, since both require creating an account tied to
a real identity (email/wallet), which shouldn't be done on someone else's behalf without
their credentials/consent (same reasoning already applied to Supabase-via-Docker
elsewhere in this project rather than creating a hosted account unprompted):
- Magic Eden: sign in at the developer dashboard (docs.magiceden.io) to generate
  `MAGICEDEN_API_KEY` — only gates `getMagicEdenBuyInstructions`, browse/listings
  already work without it.
- Tradeport: submit the Asana form (linked in `lib/nft/tradeport.ts`) for
  `TRADEPORT_API_KEY` — gates everything on that vendor, including browse.

**Reminder before shipping**: the OpenSea key in use is the low-limit, 30-day-expiring
agent tier — swap for a real account-based key (opensea.io/settings/developer, needs
email verification + org name/website/use-case) before any real traffic, not just before
buy-execution goes live.

---

## 2026-07-20b — NFT vendor client layer: Magic Eden + OpenSea + Tradeport (Phase 1)

**Status: collection-browse code done, typechecked/linted/built clean, Magic Eden's
Solana browse live-verified end to end through the running app. OpenSea and Tradeport
both require API keys not yet obtained — neither has been live-verified for real data,
only for the correct "missing key" failure mode. No buy-execution code yet (needs the
Relay `call` live test first, plus keys for every vendor's buy endpoint).**

### What was built
- `lib/nft/types.ts` — shared `NftCollection`/`NftListing` types, vendor- and
  chain-family-tagged (`solana` | `evm` | `move`) since no single vendor spans more than
  one family (see PLAN.md's "Multichain NFT section" for why).
- `lib/nft/magiceden.ts` — Solana. `browseMagicEdenCollections`, `getMagicEdenCollection`,
  `getMagicEdenListings` all confirmed keyless live. `getMagicEdenBuyInstructions` stubbed
  (throws a clear error) — confirmed live that the `/instructions/buy_now` endpoint 401s
  without `MAGICEDEN_API_KEY`, unlike everything else on this vendor.
- `lib/nft/opensea.ts` — EVM. `getOpenSeaCollection` (single-slug lookup) confirmed
  keyless live. `browseOpenSeaCollections`, `getOpenSeaListings`, `getOpenSeaFulfillmentData`
  all require `OPENSEA_API_KEY` (confirmed live 401 without one) — stubbed with a clear
  error via `requireOpenseaKey()`.
- `lib/nft/tradeport.ts` — Sui/Aptos/Movement. Explicitly marked UNVERIFIED in a file-top
  comment: Tradeport denies even GraphQL introspection without a key (confirmed live,
  `{ __typename }` → "Access to resource denied"), and its docs don't publish concrete
  query examples, so the `${chain}_collections`/`${chain}_listings` table names used here
  are a best-guess from their documented Hasura-style naming convention, not confirmed
  correct. Needs correcting via real introspection once `TRADEPORT_API_KEY` exists (an
  approval-gated Asana form, same pattern as Tensor).
- `app/api/nft/collections/route.ts` — public browse endpoint, rate-limited like
  `app/api/tokens/list/route.ts`, routes on a `chainFamily` query param
  (`solana`/`evm`/`move`) to the matching vendor client.

### A real bug found and fixed during live verification
`browseOpenSeaCollections` was initially written as keyless based on one successful ad-
hoc `curl` during research (`GET /api/v2/collections?limit=1` → 200 with real data). A
clean re-test of the same endpoint (`limit=20`, no other params changed) returned 401
"Missing an API Key" — the first result wasn't reproducible and was wrong to trust. Fixed
by adding `requireOpenseaKey()` to `browseOpenSeaCollections`. Only OpenSea's single-
collection lookup (`getOpenSeaCollection`) is actually, repeatably keyless — confirmed
by testing it twice. **Lesson: one successful call to a third-party API is not
confirmation of its auth requirements — inconsistent or cached responses can pass once
and fail on retest; retest before writing "confirmed keyless" into code comments or
docs.**

### Live-verified (real requests against the running dev server)
- `GET /api/nft/collections?chainFamily=solana` → real Magic Eden collection data
  (e.g. "Variationz I"), no key configured.
- `GET /api/nft/collections?chainFamily=evm` → correctly surfaces
  `"OPENSEA_API_KEY is not set..."` rather than a raw 401, no key configured.
- `GET /api/nft/collections?chainFamily=move&chain=sui` → correctly surfaces
  `"TRADEPORT_API_KEY is not set..."`, no key configured.
- `GET /api/nft/collections` (no `chainFamily`) → `400`.
- `GET /api/nft/collections?chainFamily=move` (no `chain`) → `400`.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean.

### Not done yet
- No real API keys obtained for any of the three vendors — Magic Eden's buy endpoint,
  all of OpenSea beyond single-collection lookup, and literally all of Tradeport remain
  untested against real data/keys.
- No single-NFT detail view, no buy-execution code, no UI wired to any of this yet — this
  pass is the data-layer foundation only.
- Tradeport's query shapes need correcting via real schema introspection once a key
  exists — treat as draft, not working code, until then.
- Relay `call` live test (see PLAN.md) still pending — needed before deciding whether EVM
  NFT buys can be a single signed intent or need two steps like Solana/Move will.
- TON (GetGems) and Bitcoin (UniSat) explicitly deferred per user decision 2026-07-20 —
  see PLAN.md's "Pending / deferred" section, not part of this pass.

---

## 2026-07-20 — Rate limiting migrated to Upstash Redis

**Status: code done, typechecked/linted/built clean, live-verified against the running
dev server. NOT yet active in production — needs a real Upstash database created and
its credentials set in the deploy env.**

### What changed
`lib/rate-limit.ts` rewritten to use `@upstash/ratelimit` + `@upstash/redis`
(sliding-window limiter, one `Ratelimit` instance cached per distinct
`(limit, windowMs)` pair) when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are
set. Falls back to the previous in-memory fixed-window limiter when those env vars are
absent — kept deliberately, same reasoning as using local Supabase via Docker instead of
requiring a hosted account for every dev session — and logs a `console.warn` once at
module load if `NODE_ENV=production` with no Upstash configured, so a real deploy
without credentials set is loud, not silent.

`rateLimit()` is now `async` (Upstash's REST API is a network call). Updated all 11 call
sites across `app/api/**` (auth/challenge, auth/verify, bridge, bridge/confirm, quote,
quote/preview, referral, swap, swap/confirm, tokens/chains, tokens/list) to `await` it —
all were already inside `async` route handlers, so this was a pure addition, no other
control-flow changes needed.

### Verified
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass clean.
- Live-verified the fallback path (no Upstash env vars set, matches current
  `.env.local`) against the running dev server: hit `/api/tokens/chains` (unauthenticated,
  limit=60/60s) 62 times in a loop — requests 1-60 returned `200`, 61-62 returned `429`,
  matching the configured limit exactly.
- Confirmed the production-mode warning fires during `npm run build` (which sets
  `NODE_ENV=production`) and does *not* fire under `npm run dev`.

### Not done yet
- No real Upstash database exists yet — `UPSTASH_REDIS_REST_URL`/`_TOKEN` are documented
  in `.env.example` and `.env.local` (commented, both empty) but not filled in. Until a
  real user creates one at console.upstash.com and sets both vars, this app is still
  running on the single-instance in-memory fallback everywhere, same practical behavior
  as before — the Redis path is coded and tested but not yet exercised against a real
  Upstash endpoint.
- `lib/cache.ts` has the identical in-memory/single-instance limitation and was
  deliberately left alone this pass — see `SECURITY.md` "Known open gaps" #1.

---

## 2026-07-18i — Sell side: support origins beyond Solana

**Status: backend fully built and live-verified (real authenticated quote created
against real Relay data, correct DB state, correct route selection). EVM wallet
connect/signing UI built, typechecked/linted/built clean, but not yet exercised with a
real browser + real EVM wallet + real funds — that's the natural next verification
step, same as how the Solana-origin cross-chain path was proven out over several
messages earlier this session.**

### What changed
Sell was hard-locked to Solana because Jupiter (Solana-only) was assumed to be required
for the first leg of every swap. Research this session found that's not true: **Relay's
`/quote` accepts arbitrary origin tokens directly, on any chain** — confirmed live with
a real ERC20 (100 USDC on Ethereum → SOL, no Jupiter involved) both in ad-hoc testing
and now through the actual running app (see DB verification below). Jupiter remains
valuable for Solana specifically (deeper aggregated DEX liquidity than Relay's own), but
was never a hard requirement for other chains.

- **Solana-origin sells are completely unchanged** — same Jupiter+Relay two-leg path,
  same code, zero risk of regression. New non-Solana origins get a single-leg,
  Relay-direct path (no Jupiter — it can't run there).
- `lib/chains/relay.ts`'s `getRelayQuote()` generalized to accept `originChainId`/
  `originCurrency`/`userOriginAddress`, defaulting to the Solana constants so existing
  call sites are untouched.
- `app/api/quote/route.ts` and `app/api/quote/preview/route.ts` both branch on
  `sourceChainId` — Solana keeps the existing logic verbatim; non-Solana calls Relay
  directly. `source_chain` in `swap_quotes` now stores the real chain id instead of
  being hardcoded to `"solana"` (existing column, no migration).
- `app/api/swap/route.ts`'s existing "source is already SOL, skip Jupiter, mark
  leg1_confirmed immediately" branch got one more trigger condition:
  `source_chain !== 'solana'` — a non-Solana origin has no conversion step by
  definition, so it's trivially "done" the same way.
- `app/api/bridge` and `app/api/bridge/confirm` needed **zero changes** — both were
  already chain-agnostic (they just replay whatever `steps` are stored and poll Relay's
  `/intents/status`), which is what made this a much smaller change than it looked at
  first.
- Points/USD volume: `lamportsToUsd(leg1_out_amount, ...)` assumed leg1 output is always
  SOL-lamports — breaks for non-Solana origins (`leg1_out_amount` there is raw
  origin-token units, USDC atomic units / wei / etc.). Fixed in
  `app/api/bridge/confirm/route.ts` by branching on `source_chain`: Solana → unchanged;
  else → `relay_route.details.currencyIn.amountUsd`, Relay's own quote-time USD
  valuation, already stored in the JSONB blob, no extra price lookup needed.
- New `lib/client/useEvmWallet.ts` (viem + injected provider only, no WalletConnect —
  matches the deliberately-trimmed Solana wallet set from 2026-07-17) +
  `app/components/EvmWalletButton.tsx`. Purely a signing tool for the Sell side when
  it's non-Solana — **account/session identity stays Solana-anchored for every user,
  always**, a conscious constraint, not an oversight (a user with only an EVM wallet
  cannot use this app at all).
- `SwapPanel.tsx`'s Sell-side picker changed from `mode="solana-only"` to
  `mode="multi-chain"`. New `isBuyTokenAllowed()` (exported so `page.tsx`'s `flip()` can
  reuse the same rule) enforces two things: the pre-existing native-SOL-only-on-Solana
  Buy restriction, plus a new one — same-chain EVM-to-EVM is blocked, both in the UI
  filter and, since UI filters are bypassable via direct API calls, **also server-side**
  in `/api/quote` (confirmed live: returns 400 "Same-chain swaps on this chain aren't
  supported yet").
- `SelectedToken` (`TokenSelectModal.tsx`) gained an `isNative` field it didn't have
  before — needed for `flip()` to validate the post-flip state without an extra fetch.

### A real bug found and fixed during live verification (not caught by typecheck/lint)
The frontend sends the literal string `"SOL"` as `destToken` when the Buy side is
Solana (see `SwapPanel.tsx`) — this worked fine before because a Solana-origin swap to
Solana always took a same-chain shortcut that never called Relay at all. The new
non-Solana-origin path has no such shortcut (it always calls Relay, regardless of
destination), which exposed that `"SOL"` was never translated into Relay's actual
native-SOL address before being sent — Relay rejected it outright
(`INVALID_INPUT_CURRENCY`). Fixed by exporting `RELAY_NATIVE_SOL_SENTINEL` from
`lib/chains/relay.ts` and translating `destToken` in both `/api/quote` and
`/api/quote/preview` whenever `destChainId === SOLANA_CHAIN_ID && destToken === "SOL"`.
Caught by actually running the live verification curl calls from the plan, not by
typecheck/lint/build — worth remembering that this class of bug (a string that's fine
in isolation, wrong only in a newly-reachable combination) doesn't show up any other way.

### Live-verified (real authenticated request against the running app, not curl-only)
Signed in with a real generated keypair, then called `/api/quote` for real: 100 USDC on
Ethereum → SOL on Solana. Confirmed directly in Postgres: `source_chain='1'`,
`source_mint` = the real USDC address, `dest_chain='solana'`, `jupiter_route` is NULL
(no Jupiter leg, correct), `relay_route` is populated (real Relay quote data present).

### Not done yet
- No real swap executed through this new path yet — needs a real browser with an
  injected EVM wallet (MetaMask/Rabby/etc.) holding real funds, following the same
  verification pattern already used for the Solana-origin cross-chain swaps earlier this
  session (check `swap_transactions.status='complete'`, `leg2_tx_hash` populated,
  confirm on the real destination chain's RPC).
- `evmWallet.ensureChain()`'s actual network-switch prompt hasn't been exercised in a
  real wallet — code path is built per the live-confirmed EVM step shape, untested live.
- The two-step ERC20 approve+deposit signing loop hasn't been exercised against a real
  ERC20 origin — only the quote-generation side of that path has been verified so far;
  actually signing and sending both steps in sequence, waiting for the approve receipt,
  is unverified.
- Same-chain EVM research (whether Relay's own aggregation could handle e.g. USDC→ETH
  both on Ethereum) remains unexplored — deliberately scoped out, now also blocked
  server-side rather than left as an untested landmine.

---

## 2026-07-18h — RESOLVED: Relay app-fee settlement question (2026-07-18d/f)

**The open question from 2026-07-18d/f is closed. Not a bug — Relay's fee model is
off-chain accrual + manual claim, not a per-swap on-chain transfer.**

### What was found
A second real swap (swapId `a4b2d0b4-f14e-43fd-b5f1-4aac9f8faf4a`, $1.16 volume, crossed
the points floor — 1 point correctly credited) used a **different** destination address
than the fee wallet, finally isolating the two. Checked the fee wallet
(`0x6155bA22a5eac7C1f9185ea139901ABB8e2Af8c3`)'s Arbitrum ETH balance before and after:
**identical** (`0x675fda9a39d98` both times) — zero on-chain change from this swap's fee.

Read Relay's dedicated App Fees doc (`docs.relay.link/features/app-fees`, not just the
general Fees overview, which only vaguely says fees "accrue offchain") to find out why:
> "App Fees accrue in an offchain base USDC balance and can be withdrawn as desired at
> your convenience."

Fees are **not** paid out per-transaction on-chain — they accumulate in an off-chain
USDC ledger Relay maintains per recipient address, claimable anytime via
`/app-fees/{address}/balances` (check) and `/app-fees/{claimAddress}/claim` (withdraw,
requires an EIP-191 signature + `/execute/permits`), or more simply through
https://relay.link/claim-app-fees. Claiming to Base is free; other chains/currencies
need the accrued amount to exceed ~$0.025 to be worth the withdrawal gas.

**Confirmed the fee is actually accruing correctly**: queried the real balance —
`0.004784 USDC on Base` — consistent with 0.25% of the two small test swaps run so far.

### Implication for future testing/ops
Don't check "did the fee arrive" by watching the fee wallet's on-chain balance — check
`GET https://api.relay.link/app-fees/{address}/balances` instead. This is worth a small
`lib/fees.ts` or admin-only helper eventually if fee monitoring becomes a regular need,
but wasn't built this session (kept to diagnosis + verification, not new tooling).

### Jupiter-leg fee also checked, also confirmed working
Queried the wrapped-SOL `feeAccount` (`3R4CsNnbNBrr8WeHqHQm4THzscp7aoWZXSXcmEsSWbzj`)
balance directly: **0.000038967 SOL** — consistent with 0.25% of the Jupiter-leg
conversion in the second test swap. Unlike Relay's, this leg settles on-chain
immediately per-swap, no claim/withdrawal step needed. Both fee mechanisms are now
independently confirmed working correctly, end to end, on real mainnet transactions.

### Not done yet
- No claim/withdrawal of the Relay-side accrued balance has been performed — it's
  sitting untouched, which is fine (claim whenever, per the docs).

---

## 2026-07-18g — Fixed: Solana token search always went through Relay

**Status: fixed, live-verified.**

### The bug
User searched for a real, liquid, graduated pump.fun token
(`3e9KmQMfEw4ShVwJ8k9sur97uqNgGyGsdoEkp5T8pump`, symbol `brick`) in the Sell-side picker
and got no results. `lib/chains/tokenList.ts`'s search branch called
`searchRelayCurrencies()` unconditionally, regardless of chain — but Relay's currency
index is scoped to what it can *bridge*, not the full universe of Solana SPL tokens.
Confirmed live: Relay's own `/currencies/v2` returned `[]` for this exact token, while
Jupiter's `/tokens/v2/search` found it immediately with real liquidity/holder data. This
is the same "Jupiter is the actual execution authority for the Solana leg, not Relay"
principle already applied to trending (`lib/chains/trending.ts`) — search just hadn't
gotten the same treatment when it was originally built.

### The fix
- `searchJupiterTokens()` added to `lib/chains/jupiter.ts` (`/tokens/v2/search`).
- `getTokenListForChain()` in `lib/chains/tokenList.ts` now dispatches search by chain:
  Solana → Jupiter, everything else → Relay (unchanged, still correct there since Relay
  genuinely is the execution authority for non-Solana destinations).
- Safe for the Buy-side modal too even though it also hits this same function for a
  Solana selection (e.g. via "All Chains" fallback) — `SwapPanel.tsx`'s `buyTokenFilter`
  already restricts Solana Buy-side picks to native SOL only regardless of what the
  underlying search returns, so broadening Solana search results here doesn't reopen
  the "can't actually deliver this" gap fixed in 2026-07-18b.
- **Live-verified**: `/api/tokens/list?chainId=792703809&term=3e9Km...pump` now returns
  the token (symbol `brick`, name "brick by brick") directly from the running app.

---

## 2026-07-18f — First fully verified real cross-chain swap (mainnet)

**Status: milestone — the whole stack worked end to end on real funds. swapId
`4636cf5e-3e59-40fc-95f2-3853c2cc9b7c`.**

### What happened, and how it was verified (not just trusted)
- User ran a real 0.01 SOL → native ETH on Arbitrum swap through the running app.
- Hit two real bugs first, both fixed in-session before this succeeded:
  1. `buildRelayDepositTransaction`'s `connection.getAddressLookupTable()`/
     `getLatestBlockhash()` calls 403'd against the public Solana RPC — confirmed by
     reproducing the exact same calls from this server (which succeeded, ruling out a
     Relay-side issue) and recognizing the public-RPC rate-limiting pattern already
     flagged in the README. Fixed by switching `NEXT_PUBLIC_SOLANA_RPC_URL` to a
     dedicated Helius endpoint — confirmed live and baked into the served JS bundle
     before declaring it fixed (grepped the actual compiled chunk for the new URL rather
     than assuming a restart was sufficient).
  2. The prior session's "EVM signing is a fast-follow" note was **wrong** — Relay's
     "deposit" step is a *Solana* transaction (raw instructions + address lookup tables,
     Solana-format pubkeys) even when bridging to an EVM chain; the user deposits via
     Solana and Relay's solver network delivers the destination asset autonomously, no
     second wallet ever needed. Built `lib/client/relayTransaction.ts` to assemble/sign
     it with the same connected wallet, and a poll loop in `page.tsx` against
     `/api/bridge/confirm`.
- **Independently verified on-chain**, not just trusted from the DB or the client:
  - `swap_transactions.status = 'complete'`, `leg2_tx_hash` populated with a real hash.
  - Queried Arbitrum's RPC directly for the tx receipt: `status: "0x1"` (success), and
    the destination wallet address appears directly in the settlement logs.
  - Queried the destination wallet's live ETH balance: nonzero, consistent with real
    funds having landed.
- **Points correctly NOT credited** — the $0.75-ish swap volume is below
  `MIN_VOLUME_USD_FOR_POINTS` ($1) in `lib/points.ts`. Confirmed this was the dust floor
  doing its job, not a bug, by checking `points_ledger` (empty for this swap) and
  `swap_transactions.points_credited = false`.
- User's test used their own fee-recipient wallet (`0x6155...af8c3`) as the swap's
  destination address too, so swap output and fee income are now mixed in that one
  wallet for this particular transaction — worth using a separate address next time if
  isolating the fee amount specifically matters.

### Net effect
This is the first time every major piece — SIWS auth, quote-binding (MITM-safe),
Jupiter leg, Relay bridge (both quote *and* execution now, not just quote), server-side
settlement verification, and the platform fee — has been exercised together against
real mainnet funds and independently confirmed on-chain rather than assumed from
application state. The "not done yet" cross-chain-execution gap from every prior
session's STATE.md entry is closed.

### Still open
- Relay-fee settlement currency question from 2026-07-18d (SOL-denominated `fees.app`
  paid to an EVM `appFees` recipient) — not resolved by this test, since the fee
  recipient and swap destination were the same wallet, making the fee's own on-chain
  footprint impossible to isolate from the swap's own settlement in this specific tx.
  Needs a dedicated test with a *different* fee-recipient address to actually isolate it.
- No UI fee disclosure yet (carried over from 2026-07-18c).
- The bridge-step failure/timeout paths in `page.tsx` (leg2_failed, 40-attempt poll
  timeout) are implemented but haven't been exercised by a real failure yet.

---

## 2026-07-18d — Jupiter-leg fee activated

**Status: both fee legs now live and precision-verified. `JUPITER_FEE_ACCOUNT` is set.**

### What happened
- User created a Jupiter Referral Account (`Fjj1oDuofubQdVd8uvTUxqQuJ2wmrkrKNxrrzdbLso34`,
  owner wallet `6qnfaohEkGHrkmZ7Xn83a4PaQR22D7Zkj8fXpJmSoSSH`) via referral.jup.ag and
  added a **wrapped-SOL** token account to it — the correct choice, since that's the only
  mint our Jupiter leg ever outputs (a cbBTC-denominated account was discussed and
  correctly ruled out: `feeAccount` must match the swap's actual output mint, and
  changing the leg's output to cbBTC would break the Relay-bridging design, which
  requires SOL as leg 2's input).
- Jupiter's classic Referral Program doesn't expose the `feeAccount` address directly —
  only the referral account pubkey. Derived it myself instead of asking the user to dig
  through the dashboard: pulled `@jup-ag/referral-sdk`'s source
  (`unpkg.com/@jup-ag/referral-sdk@0.3.0/dist/index.js`) to get the exact PDA seeds
  (`["referral_ata", referralAccountPubkey, mint]`, program
  `REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3`), then computed it locally with
  `@solana/web3.js`'s `findProgramAddressSync` (pure derivation, no transaction) →
  `3R4CsNnbNBrr8WeHqHQm4THzscp7aoWZXSXcmEsSWbzj`. **Verified this wasn't just a
  plausible-looking address** by querying it on mainnet before trusting it: confirmed it
  exists, is owned by the SPL Token Program, and is exactly 165 bytes (a real,
  initialized token account) — not a guess.
- Set `JUPITER_FEE_ACCOUNT` in `.env.local` to that derived address.
- **Precision-verified live** (same method as the Relay-leg verification): two
  back-to-back raw Jupiter quotes for 10 USDC → SOL, with vs. without
  `platformFeeBps=25`, returned `platformFee: {amount: 333686, feeBps: 25}` — exactly
  0.25% of the quoted output, confirming Jupiter accepts and correctly applies the fee
  parameter for this route.

### Both legs are now active
| Leg | Recipient | Rate | Mechanism |
|---|---|---|---|
| Relay (cross-chain) | `0x6155bA22a5eac7C1f9185ea139901ABB8e2Af8c3` (EVM) | 25 bps | `appFees` on `/quote` |
| Jupiter (Solana) | `3R4CsNnbNBrr8WeHqHQm4THzscp7aoWZXSXcmEsSWbzj` (wrapped-SOL token account, owned by referral account `Fjj1oDuofubQdVd8uvTUxqQuJ2wmrkrKNxrrzdbLso34`) | 25 bps | `platformFeeBps`+`feeAccount` on `/quote`+`/swap` |

### Open question carried over, still unresolved
During this session's research (before being redirected to the cbBTC/Jupiter question),
an important gap surfaced for the **Relay** leg specifically: a live test showed
`fees.app.currency` is denominated in **origin-side SOL**, even when the `appFees`
recipient is an EVM address (`0x6155...`). Relay's docs don't explain how a Solana-native
SOL fee actually gets delivered to an EVM address — whether Relay converts/settles it
automatically, or whether this is a latent misconfiguration. **This has not been
resolved.** Given real fee volume will start flowing through this path, it's worth either
(a) finding Relay's actual settlement docs/support to confirm, or (b) running one small
real cross-chain swap and checking whether `0x6155...` actually receives anything, before
assuming the Relay-leg fee is being collected correctly at scale.

### Not done yet
- The Relay-fee settlement question above.
- No real (funded) end-to-end swap run yet through either fee path — both were verified
  via isolated quote-level API tests, not a live signed transaction.
- Still no UI disclosure of the fee (see 2026-07-18c).

---

## 2026-07-18c — Platform fee (0.25% default)

**Status: Relay-leg fee live and precision-verified against real quotes. Jupiter-leg fee
built but inactive — waiting on a manual, wallet-signed step only the user can do.**

### What's done
- `lib/fees.ts` — centralizes both fee legs. `RELAY_FEE_BPS`/`JUPITER_FEE_BPS` (both
  default 25 bps = 0.25%) and their recipients, read from env.
- **Relay leg (cross-chain), active now**: `RELAY_FEE_RECIPIENT=0x6155bA22a5eac7C1f9185ea139901ABB8e2Af8c3`
  set in `.env.local`, wired into `getRelayQuote()`'s `appFees` param
  (`lib/chains/relay.ts`). No account setup needed — Relay accepts any EVM address as an
  `appFees` recipient directly. **Precision-verified live**: two back-to-back Relay
  quotes for the same 1 SOL → USDT route, with vs. without `appFees`, showed
  `fees.app.amountFormatted = "0.0025"` (exactly 0.25% of 1 SOL, ≈$0.187) and the output
  dropped by exactly that amount. Not an estimate — confirmed against the actual API.
- **Jupiter leg (Solana same-chain leg), built but dormant**: `platformFeeBps` +
  `feeAccount` wired into `getJupiterQuote()`/`buildJupiterSwapTransaction()`
  (`lib/chains/jupiter.ts`), gated behind `JUPITER_FEE_ACCOUNT` being set — currently
  empty, so this leg charges nothing yet. Jupiter's mechanism requires a **one-time,
  wallet-signed** step at referral.jup.ag (create a referral project, then a token
  account specifically for wrapped SOL — the only mint this leg ever outputs) that
  cannot be done from code; the user is completing this with Solana wallet
  `6qnfaohEkGHrkmZ7Xn83a4PaQR22D7Zkj8fXpJmSoSSH`. Once they have the resulting
  `feeAccount` address, paste it into `.env.local`'s `JUPITER_FEE_ACCOUNT` and the fee
  activates immediately — no further code changes needed.
- Both `/api/quote` (real execution) and `/api/quote/preview` (unauthenticated preview,
  see previous entry) call the same `getJupiterQuote`/`getRelayQuote` functions, so the
  fee is automatically reflected in the previewed amount too, not just at execution —
  matches what was promised when the preview feature was pitched.
- Distinguished for the user during this session: the `jup.ag/?ref=` link they initially
  shared is Jupiter's own consumer referral/points program (rebates on trades through
  *their* UI) — a different system from the developer-facing Referral Program
  (`platformFeeBps`/`feeAccount`) needed to actually collect a fee on swaps executed
  through *our* API calls. Don't conflate the two if this comes up again.

### Not done yet
- Jupiter-leg fee inactive until `JUPITER_FEE_ACCOUNT` is set (see above) — check
  `.env.local` before assuming both legs are charging.
- No UI surfacing of the fee yet (e.g. "includes a 0.25% fee" disclosure on the swap
  panel) — the fee is real and already reduces the quoted/executed amount, but it isn't
  currently labeled as such anywhere in the interface.

---

## 2026-07-18b — Unauthenticated live quote preview + a real production bug fix

**Status: done, live-tested end to end with curl (no auth, no wallet). Dev server +
local Supabase running.**

### What's done
- New public, unauthenticated endpoint `GET /api/quote/preview` (`app/api/quote/preview/
  route.ts`) — "how much would I get" pricing without a connected wallet or session.
  Deliberately separate from `POST /api/quote`: creates nothing in the DB, binds no
  address, can never be used to execute a swap (see file header comment and
  `SECURITY.md`-style reasoning inline). Uses well-known placeholder sender/recipient
  addresses when calling Relay (`PREVIEW_SOLANA_PLACEHOLDER` = Solana System Program id,
  `PREVIEW_EVM_PLACEHOLDER` = a burn address) — verified live that Relay returns full,
  accurate pricing for any well-formed placeholder pair; it only rejects when
  sender==recipient.
- `SwapPanel` now fetches this preview internally (400ms debounce + `AbortController`,
  5s server-side cache keyed on the exact params) and renders it directly in the Buy
  panel — the "no live preview" gap flagged in the previous session's `STATE.md` entry is
  closed.
- **Live-verified** (curled directly against the running app, no auth):
  - 1 SOL → USDT on Ethereum: `74.74 USDT (~$74.68)`
  - 10 USDC (SPL) → USDT on Base: `9.94 USDT (~$9.93)`
  - 1 SOL → SOL (same-chain passthrough): `1 SOL (~$74.99)`
- Restricted the Buy-side token picker to native SOL only when the selected chain is
  Solana (`buyTokenFilter` in `SwapPanel.tsx`, via `TokenSelectModal`'s new
  `filterTokens` prop). **Why this exists**: execution only ever produces native SOL for
  a same-chain leg (Jupiter's output, see `AGENTS.md`) — before this fix, the Buy modal
  cosmetically let you pick e.g. USDC on Solana as the Buy token, but the app would
  silently deliver SOL instead. This was a latent bug introduced in the previous
  session's UI rewrite, not something introduced by the preview feature — caught while
  building the preview's same-chain branch and fixed here since it's the same code path.

### A real production bug found and fixed (not preview-specific — this affected live points crediting)
`lib/pricing.ts`'s `getSolUsdPrice()` called `lite-api.jup.ag/price/v2`, which now
**404s** ("Route not found") — Jupiter retired it. This function is called from
`app/api/swap/confirm/route.ts` and `app/api/bridge/confirm/route.ts` right before
`creditSwapPoints()`, on *every* completed swap. **This means points crediting has been
silently broken since whenever Jupiter retired v2** — a swap would confirm fine on-chain,
but the points-ledger insert would throw afterward. Fixed: switched to
`lite-api.jup.ag/price/v3`, whose response shape also changed (flat
`{[mint]: {usdPrice}}` instead of `{data: {[mint]: {price}}}`) — updated the parsing to
match. **If a future session sees "swap confirmed but no points appeared," check this
function first** — it's exactly the failure mode this bug produced, and Jupiter APIs have
already moved once without a deprecation the app noticed.

### Not done yet
- No real (funded, signing) end-to-end mainnet swap has been run this session to confirm
  points now actually land after the pricing fix — only the price lookup itself was
  re-verified in isolation. Worth doing once there's a funded test wallet.
- Preview still doesn't cover the "All Chains" aggregate case or non-EVM/non-SVM
  destination chains (skipped gracefully, returns null amounts) — same scope boundary as
  the token-list work from the previous entry.

---

## 2026-07-18 — Relay-style swap UI + real chain/token data

**Status: new UI + token-data backend built, typechecked/linted/built clean, new
endpoints verified live against real Relay/Jupiter/GeckoTerminal data. Not yet visually
confirmed in a browser — no browser automation tool was available this session; ask the
user to eyeball `localhost:3000` against `samplephotos/12.png` and `123.png`.**

### What's done
- Redesigned `app/page.tsx` around a Relay-style Sell/Buy card (`app/components/
  SwapPanel.tsx`), a trending-tokens bar (`TrendingBar.tsx`), and a two-column
  chain+token select modal (`TokenSelectModal.tsx`, `mode: "solana-only" | "multi-chain"`
  — Sell is Solana-only since Jupiter is the only source-side execution engine; Buy is
  full multi-chain since Relay bridges anywhere).
- New read-only backend: `lib/chains/relayChains.ts` (Relay `GET /chains`, 5min cache),
  `lib/chains/trending.ts` (Jupiter `toptrending` for Solana, GeckoTerminal
  `trending_pools` for EVM chains), `lib/chains/tokenList.ts` (merges
  featured→trending, Relay-routability-validated for non-Solana chains — see below), new
  endpoints `GET /api/tokens/chains` and `GET /api/tokens/list?chainId=&term=`.
- **Live-verified ordering** (curled against the actually running app, not assumed):
  Solana → `SOL, USDC, USDT, cbBTC, TRUMP, ...`; Base → `ETH, USDC, USDT, WETH, DEGEN,
  BRIAN, TSG, MIGGLES, ...` — native→USDC→USDT→trending confirmed on both a Solana and
  an EVM chain, exactly as requested.
- Removed the old manual "send to another chain" checkbox and raw chain-id/address text
  inputs — `isCrossChain` is now derived from the Buy-side token's chainId.

### Bugs/design issues found and fixed during this pass
1. **Relay's native-SOL address ≠ our wrapped-SOL mint.** Relay represents native SOL
   with the System Program sentinel (`111...111`), while `lib/chains/jupiter.ts`'s
   `NATIVE_SOL_MINT` (what the whole backend swap flow keys off) is the wrapped SPL mint
   (`So111...112`). Picking "SOL" in the new token modal would otherwise send the wrong
   address as `sourceMint` and break every same-chain swap. Fixed via
   `lib/client/constants.ts`'s `normalizeSolanaSourceMint()`, applied in `page.tsx`
   before every `/api/quote` call. **If a future change touches how the Sell-side token
   is resolved, re-check this normalization is still applied — it's an easy regression.**
2. **GeckoTerminal `base_token`/`quote_token` don't map 1:1 to "the trending token."**
   Naively taking `base_token` would sometimes surface ETH/USDC as "trending" on EVM
   chains. Fixed with a heuristic in `lib/chains/trending.ts`: pick whichever side of the
   pool isn't a known major (native/wrapped-native/USDC/USDT); skip the pool if both
   sides are majors. Verified live — Base trending correctly returned BRIAN/TSG/MIGGLES,
   not ETH/WETH/USDC.
3. **Trending-token routability is validated differently per side.** Destination/Buy-side
   trending candidates are cross-checked against Relay's `currencies/v2` batch lookup
   before being shown (an unroutable pick would only surface as a confusing quote failure
   later). Solana/Sell-side trending is deliberately **not** cross-checked against Relay —
   Jupiter, not Relay, executes that leg, and Jupiter's own trending list is already the
   authoritative "can this actually be swapped" signal there. Don't "fix" this into a
   blanket check later without re-reading `lib/chains/tokenList.ts`'s comment.

### Explicit scope decisions / known simplifications
- "All Chains" in the modal does not aggregate a real cross-chain top list yet (all
  trending/token sources are chain-scoped) — it currently falls back to showing the
  Solana list. Flagged as a fast-follow, not silently pretended-away: see the comment in
  `TokenSelectModal.tsx`.
- No live Buy-side amount preview (the reference UI shows a live conversion estimate;
  building that would mean calling `/api/quote` on every keystroke, which creates a
  `swap_quotes` row per call and eats into the existing 20/min rate limit on that route).
  `buyAmountDisplay` stays blank until a swap is actually run. This wasn't in the
  approved plan's scope — flagging in case it's assumed to exist.
- GeckoTerminal trending coverage is currently Ethereum, Base, Arbitrum, Optimism,
  Polygon, BSC, Avalanche (`GECKOTERMINAL_NETWORK_SLUGS` in `lib/chains/trending.ts`) —
  chains outside that map just show featured+search, no trending row.

### Not done yet
1. Visual QA against `samplephotos/` — needs a real browser, not done this session.
2. The pre-existing EVM-side Relay step execution gap (see the 2026-07-17 entry) is
   unchanged by this pass — token *selection* now covers any chain, but actually signing
   the cross-chain leg still isn't wired into the UI.
3. `/api/tokens/chains` and `/api/tokens/list` are public/unauthenticated by design (pure
   market data) but only rate-limited, not cached at the CDN/edge level — fine for now,
   revisit if traffic grows.

---

## 2026-07-17 — Initial build: scaffold, backend, local Supabase, first bug fix

**Status: local dev fully wired and smoke-tested. Not deployed anywhere. Not yet tested
against real mainnet funds.**

### What's done
- Next.js 16 (App Router, TS, Tailwind) scaffolded in place, package renamed
  `swapper-between-chains` (npm forbids capitals, dir name kept as-is).
- Full backend: SIWS auth, quote-binding, two-leg swap state machine, points/referral
  ledger — see `AGENTS.md` for the architecture and `SECURITY.md` for the threat model.
- `lib/chains/jupiter.ts` and `lib/chains/relay.ts` — quote + execute wrappers for both
  external APIs.
- Supabase schema (`supabase/migrations/0001_init.sql`, `0002_grants.sql`) — 7 tables,
  RLS policies, a points-balance view, explicit API-role grants.
- Local Supabase stack running via Docker (`npx supabase start`) — chosen over a hosted
  cloud project because creating a Supabase account/project isn't something that can be
  done without the user's credentials/interaction. `.env.local` points at it.
- `npm run build`, `npx tsc --noEmit`, `npm run lint` all pass clean.

### End-to-end tested (real requests against the running local stack)
- Full SIWS flow with a real generated ed25519 keypair: challenge → sign → verify → JWT
  session cookie → authenticated `/api/points` and `/api/referral` reads succeed.
- Unauthenticated requests to `/api/points` and `/api/quote` correctly 401, no data leak.
- DB: all 7 tables + RLS policies + `user_points_balance` view confirmed present via
  direct psql inspection inside the Supabase Postgres container.

### Bugs found and fixed during this pass
1. **SIWS message mismatch (would have broken 100% of logins)** — `buildChallengeMessage`
   embeds an `Issued At` timestamp. It was being called twice: once at challenge issuance,
   once again at verify time — producing two different messages with two different
   timestamps, so every signature check failed. Fixed by persisting the exact issued
   message in `auth_challenges.message` and replaying it verbatim at verify. See
   `SECURITY.md` auth section — don't reintroduce this by "simplifying" the message
   generation back to a pure function called twice.
2. **Missing table grants** — Supabase's newer default does not auto-expose new
   `public` schema tables to `anon`/`authenticated`/`service_role`, even with RLS
   policies defined. First attempt to hit `/api/auth/challenge` failed with "permission
   denied for table auth_challenges" (not an RLS-style rejection). Fixed via
   `0002_grants.sql`. Any new table added later needs the same treatment.
3. **`@solana/wallet-adapter-wallets`** pulled in ~20 legacy wallet SDKs and 94 npm audit
   vulnerabilities (1 critical, 10 high). Swapped for just `@solana/wallet-adapter-phantom`
   + `@solana/wallet-adapter-solflare`, down to 16 moderate.

### Explicit scope decisions (asked of the user, not assumed)
- Uniswap **not** integrated directly for v1 — Relay already routes through
  destination-chain DEX liquidity; add `lib/chains/uniswap.ts` later only if a specific
  pair proves Relay can't cover it.
- Points ledger is fraud-*schema-ready* (`status` column, min-volume floor) but has
  **no active fraud detection** in v1 — deliberate, not an oversight.
- Auth/DB: Next.js API routes + Supabase Postgres (not a separate backend service).
- Deploy target: Vercel for the app, GoDaddy kept only as the domain registrar (DNS
  pointed at Vercel) — GoDaddy's own hosting is not used.
- Network: **Solana mainnet**, not devnet/testnet, per explicit instruction.

### Not done yet (the actual next steps, in rough priority order)
1. **EVM-side Relay step execution in the UI.** `app/api/bridge/route.ts` returns Relay's
   raw execution steps, but nothing in `app/page.tsx` signs/broadcasts them — that needs
   an EVM wallet integration (wagmi/viem) that hasn't been added. Same-chain Jupiter swaps
   are fully wired end to end (quote → sign → confirm → points); cross-chain is not yet
   exercised against real funds.
2. **`/api/bridge/confirm` trusts client-reported destination tx data** instead of
   verifying against Relay's status API — see `SECURITY.md` gap #1. Close before real
   volume.
3. **Migrate local Supabase → a real hosted project** once the user creates one, via
   `supabase link` + `supabase db push` (same migration files apply as-is).
4. Rate limiting is in-memory/single-instance — fine for now, not for multi-instance prod.
5. Dedicated mainnet RPC provider (Helius/QuickNode/Triton) — currently using the public
   rate-limited endpoint.
