# Plan

Forward-looking scope/research doc — not a build log (that's `STATE.md`) and not a
threat model (that's `SECURITY.md`). Update as items resolve; don't delete resolved
items, mark them done so the history of *why* a decision was made stays visible.

---

## In progress: Multichain NFT section (added 2026-07-20)

### Build order (decided 2026-07-20)
**Phase 1 (building now): Magic Eden (Solana) + OpenSea (EVM) + Tradeport (Sui/Aptos/
Move).** These three cover Solana, the entire EVM chain list, and the Move ecosystem —
the large majority of real NFT trading volume.

**Deferred, not dropped — pending (see "Pending / deferred" below): TON (GetGems) and
Bitcoin Ordinals/Runes (UniSat).** Explicit user decision 2026-07-20: leave these two
aside for now, revisit after Phase 1 ships. Tensor (Solana fallback) also comes after
Phase 1 — apply for its gated access in parallel since that's a waiting-on-a-form item,
not blocking work.

### Goal
Let a user browse NFT collections across chains (Solana + EVM), click into a
collection, and buy a specific listed NFT while paying with a **different chain's
token** than the NFT's native chain — e.g. pay in ETH on Ethereum, receive a Solana
NFT at a wallet address they specify. Same underlying idea as the existing token
swap feature (`app/api/quote`, `app/api/bridge`) but the destination "asset" is a
specific NFT instead of a fungible token amount.

### Why this is architecturally bigger than the token-swap feature
Token swaps have a continuous output amount — Relay/Jupiter just need a destination
mint and an amount. An NFT purchase is atomic and priced by a *seller's specific
listing*, which can be delisted or repriced between quote and execution. The
likely shape:
1. User picks an NFT priced in the destination chain's native/quote currency
   (e.g. a Solana NFT listed in SOL).
2. Origin-chain payment (e.g. ETH) gets swapped to the destination chain's quote
   currency via the **existing Relay integration** (`lib/chains/relay.ts`) — no new
   bridging code needed, this part is already built and live-verified.
3. Once the swapped funds land on the destination chain, execute the actual NFT
   buy transaction against whichever marketplace API sourced the listing, with the
   NFT delivered to a user-specified receive address (not necessarily the payer's
   own wallet on that chain, mirroring how destination-token delivery already works
   for the fungible-token swap).
4. Listing can go stale between step 1 and step 3 (someone else buys it, or the
   price changes) — needs a re-quote/re-check-listing step immediately before
   execution, and a clear failure/refund path if the listing is gone. This is new
   risk surface the fungible-token swap doesn't have (a token amount can't be
   "sniped" the way a specific NFT listing can).

### Marketplace APIs to search (research task, in priority order)
- [ ] **OpenSea API** (docs.opensea.io) — EVM-only. Check API v2 Listings/Offers/
  Fulfillment endpoints and Seaport protocol integration for programmatic buys
  (not just web checkout redirects). Auth model, rate limits, pricing.
- [ ] **Magic Eden API** (docs.magiceden.io) — covers both Solana and EVM now.
  Check whether it's one unified API or separate Solana/EVM APIs, and whether it
  has an instant-buy/execute-buy endpoint that returns a signable transaction.
- [ ] **Tensor** (tensor.so / Tensor Trade) — Solana-only, aggregates listings
  across Solana marketplaces including Magic Eden. Check for a public API with
  buy-instruction-building endpoints (similar shape to how Jupiter returns a
  signable swap tx in this project already).
- [ ] **Tradeport** (tradeport.xyz) — multichain NFT infra (Aptos, Solana, others).
  Check for a public developer API, cross-marketplace aggregated listings, and
  buy execution support, and which chains specifically.
- [ ] **Reservoir Protocol** (reservoir.tools) — the standard EVM NFT-aggregation
  API used by many marketplaces/wallets under the hood. Check if it has any
  Solana support, or if an equivalent aggregator exists that spans both Solana
  and EVM in a single API — would simplify the architecture a lot if so.
- [ ] **Relay.link** — already integrated for token swaps. Check their docs for
  any NFT-specific bridging/purchase primitives that might already solve part of
  this (some cross-chain bridges are adding NFT primitives).

### Per-marketplace, need to establish
- Public REST/GraphQL API vs SDK-only; auth model; free tier vs paid; rate limits.
- Chain coverage (Solana / EVM / both).
- Can it: browse collections, get active listings for a collection, get floor
  price, fetch a single NFT's current listing, and — critically — **execute or
  return a signable transaction to buy a specific listed NFT programmatically**
  (server-side, like Jupiter's swap-transaction response) vs. only a web checkout
  redirect (which would be a dead end for this feature).
- What currency the buyer must pay in on that marketplace (native token only vs
  accepts stablecoins/other tokens directly, which could remove a swap leg).
- Whether the API supports specifying an arbitrary receive address that differs
  from the paying wallet (needed for the ETH-pays/Solana-wallet-receives flow).

### Open architecture questions once research comes back
- Does any single aggregator already span both Solana and EVM, or will this
  need two separate marketplace integrations (one Solana-side, one EVM-side)
  behind a shared internal interface — likely mirroring the existing
  `lib/chains/jupiter.ts` / `lib/chains/relay.ts` split.
- How to handle listing staleness/race between quote and execution (re-check
  before executing; user-facing "this NFT was just sold" failure state).
- Fee model: does the platform fee (0.25%, see `lib/fees.ts`) apply the same way
  on an NFT purchase, or does marketplace royalty/fee stacking make that
  impractical?
- Whether NFT purchases need their own state machine/table (mirroring
  `swap_transactions`) or can reuse the existing two-leg swap machinery with the
  "leg 2" being a marketplace buy instead of a Relay-executed transfer.

### Research findings (2026-07-20)

**Critical finding: Reservoir Protocol — the standard EVM NFT-aggregation API — shut
down Oct 15, 2025.** New account creation was already disabled before shutdown;
existing customers migrated to Alchemy/Sequence. `reservoir.tools` now redirects to
Relay — **the Reservoir team pivoted directly into Relay Protocol** ("focus on Relay
Protocol to promote cross-chain token and NFT trading"). Practical consequence:
Reservoir's aggregation tech lives on through **Magic Eden's EVM API, which is
"Reservoir-powered v4."** Do not build on Reservoir directly — it no longer exists.

#### ⚠️ CORRECTION (2026-07-20, later research pass) — Magic Eden is now Solana-only

**The verdict table below (first research pass) is stale on one critical point: Magic
Eden shut down ALL of its EVM and Bitcoin NFT marketplaces on 2026-03-09** (multi-chain
wallet fully wound down by 2026-05-01), pivoting fully to Solana + token
trading/entertainment. **Magic Eden is no longer "the only vendor spanning Solana+EVM"
— it now covers Solana only.** Its Solana API is unaffected and still the right primary
Solana vendor (free reads, signed-tx buy instructions). Every EVM/Bitcoin chain the
first pass assumed Magic Eden covered has been re-homed below, mostly to OpenSea, which
independently expanded to a very large EVM chain list. See the corrected recommendation
and consolidated coverage table further down — **use those, not the table immediately
below, for chain-to-vendor decisions.**

#### Verdict per marketplace (original pass — chain column for Magic Eden is now WRONG, see correction above)

| API | Chains | Access | Buy = signable tx? | Verdict |
|-----|--------|--------|---------------------|---------|
| **Magic Eden** | ~~Solana + 8 EVM chains + BTC~~ **Solana only as of 2026-03-09** | Free key (reads free, buy instructions need Bearer key) | ✅ Solana | **Solana primary — EVM/BTC coverage is dead, do not rely on it** |
| **OpenSea v2** | EVM only, no Solana — now a very large chain list (see below) | Free API key (apply) | ✅ Seaport fulfillment | **Primary multi-chain EVM vendor** (promoted from "complement") |
| **Tensor** | Solana only (aggregates ME + its own book) | **Approval-gated (Airtable form), self-described alpha** | ✅ returns `VersionedTransaction` | **Now strategically important** — the only Solana fallback, since ME is itself Solana-only |
| **Tradeport** | Sui/Aptos/Movement/NEAR/Stacks | Key | ✅ confirmed Aptos/Sui; NEAR/Stacks buy-depth unverified | The Move-ecosystem layer — kept, not off-target |
| **Reservoir** | EVM (formerly 30+) | — | — | **Dead. Do not use.** |
| **Relay** (already integrated) | 85+ incl. Solana, EVM, BTC | Existing integration | N/A — not a catalog, it's the payment/execution glue | **The cross-chain composition layer for this whole feature** |

#### Key architectural unlock: Relay's `call` action
Relay's `Quote`/`Execute` API (already used here for token swaps) supports three
destination actions: bridge, swap, or **`call` — arbitrary destination-chain contract
execution**. Relay explicitly markets NFT mints/purchases as a supported use case and
can batch "deposit → bridge → call destination contract" into **one intent**. This
means the "pay in ETH, buy a Solana NFT" flow likely does **not** need to be hand-rolled
as two separate signed steps (swap, then buy) — Relay's `call` action may be able to
wrap a marketplace-built buy transaction (from Magic Eden/Tensor/OpenSea) as the
destination call in a single cross-chain intent, delivering the NFT to a specified
address. **This needs a spike to confirm before committing to an architecture**: test
Relay's `call` targeting (a) a Solana Magic Eden/Tensor buy tx and (b) an EVM OpenSea
Seaport fulfillment tx.

#### Feasibility confirmed
No marketplace natively supports "pay in token X on chain A, receive NFT on chain B" —
all price/sell strictly in the NFT's native chain token (SOL on Solana, ETH/native on
EVM). The cross-token/cross-chain payment must be composed via Relay, same pattern as
the existing fungible-token swap. Both Magic Eden (`/instructions/buy_now`, Solana) and
Tensor (`TswapBuySingleListingTx`) build the buy tx **server-side** and return signable
instructions/`VersionedTransaction` for the wallet to sign — same "backend builds,
wallet signs" shape already used for the Jupiter swap-transaction flow in this project.
OpenSea's fulfillment endpoint returns a signed Seaport order the same way for EVM.

#### Recommendation (revised 2026-07-20, second pass — max-coverage aggregator strategy, corrected for ME's Solana-only pivot)
User direction: don't drop any aggregator — the goal is the **broadest possible chain
coverage** ("we need to have all the chains in one same market"), using every
aggregator as a layer with fallbacks for what the primary ones don't list, mirroring
how the existing token-swap side already stacks Jupiter + Relay for maximum coverage.

1. **Magic Eden = Solana primary** (demoted from "Solana+EVM primary" after its 2026-03
   EVM/BTC shutdown, see correction above) — free self-serve key, signed-tx buy
   instructions, still the right first stop for Solana.
2. **Tensor = Solana fallback** — now more important than the first pass suggested,
   since Magic Eden itself no longer has EVM as a fallback surface; Tensor is the *only*
   other Solana aggregator researched. Access is approval-gated (Airtable form) +
   self-described alpha — **apply for access now** (a form-wait, not a technical
   blocker), integrate as try-ME-first, fall-back-to-Tensor-if-empty once approved.
3. **OpenSea v2 = promoted to primary multi-chain EVM vendor** (was "complement," now
   the main one, since Magic Eden's EVM route is dead). OpenSea's chain list turned out
   to be far larger than initially checked — see consolidated table below — and single-
   handedly covers Ethereum, Polygon, Base, Arbitrum, ApeChain, Berachain, Blast,
   Abstract, Sei, Monad, HyperEVM, and ~15 more EVM chains via one Seaport-based
   fulfillment API. **Note: OpenSea supports Solana for token *swaps* only, not NFTs** —
   it does not help Solana NFT coverage at all.
4. **Tradeport = the Sui/Aptos/Move/NEAR/Stacks layer** — kept, not off-target. Buy
   execution confirmed on Aptos/Sui; NEAR/Stacks buy-execution depth still unverified,
   flagged as an open item, not yet a blocker since those are lower-priority chains.
5. **Two new vendors added this pass, filling real gaps opened by Magic Eden's exit and
   by chains OpenSea/Tradeport don't reach:**
   - **GetGems (getgems.io)** — TON primary. Public REST/GraphQL API, free public tier +
     API key for extended access. Buy-now builds a **signable TON transfer transaction**
     to the marketplace contract (non-custodial). TON is a real, active NFT ecosystem
     (Telegram Gifts/usernames/collectibles) with no other vendor covering it.
   - **UniSat (unisat.io/open-api)** — Bitcoin Ordinals/Runes primary, filling the gap
     Magic Eden's Bitcoin shutdown opened (OpenSea has no Bitcoin support at all). 220+
     REST endpoints, API-key auth, **PSBT-based signable buy transactions** (BIP-174,
     non-custodial) — the Bitcoin-native equivalent of a signable tx. 0.5% marketplace
     fee. **Fallback: Gamma.io or OKX NFT**, both also PSBT-based, if UniSat access is a
     problem.
6. **Relay's `call` action as the payment-abstraction layer for EVM destinations** —
   spiked 2026-07-20, docs-confirmed EVM-only (see spike result below). **TON and
   Bitcoin purchases are non-EVM and non-Solana, so they need the same two-signed-step
   pattern as Solana** (Relay delivers funds to a TON/Bitcoin address, then a separate
   GetGems/UniSat buy tx is signed) — not a Relay `call`-composable single intent.
7. **Confirmed NOT new-vendor gaps** (researched, folded into existing vendors):
   Hyperliquid NFTs (native marketplace Drip.Trade shut down 2026-06-15; Hypurr/Hypers
   collections live on OpenSea via HyperEVM — route through OpenSea), Robinhood (no NFT
   product exists at all — Robinhood Chain, launched 2026-07-01, is a tokenized-
   equities L2 with no NFT ecosystem; it's already on OpenSea's chain list if that ever
   changes, nothing to build now), ApeChain (OpenSea covers it, ME's route is dead),
   Polygon (OpenSea covers it, ME's route is dead).

#### Consolidated chain → primary → fallback vendor table (2026-07-20)

| Chain | Family | Primary vendor | Fallback vendor | Notes |
|---|---|---|---|---|
| Solana | Solana | **Magic Eden** | **Tensor** (gated) | OpenSea does NOT cover Solana NFTs (swap-only) |
| Ethereum, Polygon, Base, Arbitrum, ApeChain, Berachain, Blast, Abstract, Sei, Monad, HyperEVM, Optimism, Avalanche, Zora, Ronin, Flow, Unichain, Soneium, Shape, Ink, B3, GUNZ, Somnia, MegaETH, AnimeChain, Robinhood Chain | EVM | **OpenSea** | — | Single Seaport fulfillment API covers all; Robinhood Chain has no NFTs to trade yet |
| Sui, Aptos | Move | **Tradeport** | — | Buy execution confirmed |
| Movement | Move | **Tradeport** | — | Per initial research, unverified buy depth |
| NEAR, Stacks | NEAR / Bitcoin-L2 | **Tradeport** (claimed) | Gamma (Stacks Ordinals) | ⚠️ buy-execution depth unverified — open item |
| TON | TON | **GetGems** (new) | OKX NFT | Signable TON buy tx; non-EVM, 2-step Relay funding |
| Bitcoin (Ordinals/Runes) | Bitcoin | **UniSat** (new) | Gamma / OKX | PSBT signable buy tx; non-EVM, 2-step Relay funding |

**No coverage found for**: any non-Solana/non-EVM/non-Move/non-TON/non-Bitcoin chain
(e.g. Cardano, Tezos, ICP) — not pursued, no demand signal surfaced in research, flagged
here rather than silently dropped.

#### Open architecture questions, now informed by research
- ~~Does any single aggregator span both Solana and EVM~~ — **No.** (Corrected
  2026-07-20: Magic Eden used to, but shut down its EVM/BTC marketplaces 2026-03-09 and
  is Solana-only now.) No single vendor spans multiple chain families — this app's NFT
  layer will always be a per-family vendor stack (Solana: ME/Tensor; EVM: OpenSea;
  Move: Tradeport; TON: GetGems; Bitcoin: UniSat), same shape as the existing
  Jupiter(Solana)+Relay(everything) split on the token-swap side.
- Spike needed: does Relay's `call` action actually accept a third-party-built NFT-buy
  transaction (Magic Eden/OpenSea/Tensor) as its destination call, or does the flow need
  to be built as two explicit signed steps (Relay swap → then a separate marketplace buy
  tx signed by the user once funds land)? This determines whether NFT purchases can
  reuse the existing swap state machine almost as-is, or need a new one.
- Listing staleness/race between quote and execution — still open, no marketplace
  researched offers a "hold" mechanism; needs a re-check-listing-immediately-before-
  execute step and a defined failure/refund UX regardless of which path above is chosen.
- Fee model (`lib/fees.ts`'s 0.25%) stacking against marketplace royalties — still open,
  needs per-marketplace royalty-fee-structure research once an API is chosen.
- Whether NFT purchases need their own DB table/state machine or can extend
  `swap_transactions` — depends on the Relay `call` spike outcome above.

### Relay `call` spike — RESULT (2026-07-20, docs-level, not yet a live API test)

Pulled Relay's docs directly (`use-cases/calling.md`, `api_guides/calling-integration-
guide.md`, `references/api/get-quote-v2.md`). Findings:

- The primitive is `POST /quote/v2` with a **`txs` array** in the same request body as
  the normal bridge/swap params (`originChainId`, `destinationChainId`, `amount`,
  `tradeType`, etc.) — NOT a separate endpoint. Each entry: `{to, value, data}` —
  arbitrary ABI-encoded calldata, executed sequentially on the destination chain. ERC20
  spends require a leading `approve` tx in the same array. Response is the same
  `steps`/`requestId` shape already consumed by `buildRelayExecutionSteps()` in
  `lib/chains/relay.ts` — no new response-parsing code needed on that side.
- Recipient is encoded either inside `txs[].data` (as a call parameter) or via
  `protocol.v2.orderData.output.payments[].recipient` — separate from `user` (the
  address that signs the origin deposit). This matches the "payer ≠ receiver" shape this
  feature needs.
- **`txs`/calling is EVM-only.** The docs explicitly scope gas-topup and calling
  behavior to EVM chains; Solana's section of the same schema uses an entirely different
  set of parameters (`depositFeePayer`, `maxRouteLength`, `useSharedAccounts`,
  `includeComputeUnitLimit`) with no `txs`-equivalent — confirming Solana destinations
  use the existing raw-instruction-replay model already in this codebase
  (`buildRelayExecutionSteps` → Solana instructions), not arbitrary contract calls.

**Conclusion — this changes the architecture split:**
- **EVM-destination NFT buys** (buy an Ethereum/Polygon/etc. NFT, pay from any chain):
  likely **one Relay intent** — pass an OpenSea Seaport fulfillment tx (or Magic Eden EVM
  buy tx) as `txs`, Relay delivers funds + executes the buy in the same flow the user
  already signs once. Needs a live `/quote/v2` call with a real `txs` payload to confirm
  end-to-end (not yet done — this was a docs read, not a live API test).
- **Solana-destination NFT buys** (pay ETH, buy a Solana NFT): **cannot** be one intent.
  Relay has no destination-call primitive for Solana. Must stay **two signed steps**:
  (1) existing Relay swap delivers SOL to the user's Solana address — already built and
  live-verified in this project; (2) once SOL lands, a *second*, separately-signed Magic
  Eden/Tensor `buy_now` instruction actually purchases the NFT. This is a materially
  different UX from the EVM path (two wallet approvals instead of one) and needs its own
  state machine step (track "funds delivered, purchase not yet executed" as a distinct
  status) rather than reusing `swap_transactions` as-is.

**Next step:** live-test `POST /quote/v2` with a real `txs` payload wrapping an OpenSea
fulfillment call, to confirm the docs-level read above against actual behavior, before
committing to the EVM one-step architecture. Not done yet — requires a real OpenSea API
key (not yet obtained) to generate a real fulfillment tx to wrap.

---

## Done

### NFT buy flow: backend + UI wired end-to-end, two-signature architecture (2026-07-20o/p)
Full detail in `STATE.md`. The OpenSea buy flow is live and quote/build-verified
(never yet signed with a real wallet): `app/components/NftBuyModal.tsx` + 4 new API
routes (`/api/nft/purchase/{quote,execute,confirm-deposit,confirm-buy}`) + DB migrations
0003-0006. Architecture corrected mid-build from one signature (Relay executing the
OpenSea buy directly via its `call` primitive) to two, after research confirmed the
one-signature version would very likely have stranded purchased NFTs in Relay's own
contract (Seaport can only deliver to `msg.sender`, which is Relay's Multicaller during
a relayed call, not the buyer). Two more real bugs (gas-buffer omission, OpenSea error
misclassification) caught and fixed live before ship — see STATE.md 2026-07-20p.
Remaining: never tested with a real wallet signature; origin is Solana-SOL-only (no
chain/token picker yet).

### First NFT UI: browse grid + collection/listings page (2026-07-20d)
`app/nft/page.tsx` (browse, chain-family tabs), `app/nft/[vendor]/[slug]/page.tsx`
(collection detail + listings grid), `app/components/NftImage.tsx`, plus
`app/api/nft/collection/route.ts` and `app/api/nft/listings/route.ts`. Full detail
including two real bugs found and fixed in `STATE.md` 2026-07-20d:
1. OpenSea listing schema was wrong (assumed fields that don't exist — `maker.address`,
   used `order_hash` as tokenId) — crashed every listings call, fixed.
2. Magic Eden 429s were silently reported as "collection not found" — fixed to only
   treat a real 404 as not-found, everything else now surfaces the real error.

Live-verified against the running dev server with real data (Magic Eden Solana
collections, OpenSea EVM listings with real prices). **Buy is a disabled placeholder
button everywhere — no buy-execution code exists yet.** No real-browser visual QA done
(no browser automation available this session) — only curl + server-log verified, worth
an actual eyeballed pass before calling this polished.

### NFT Phase 1 data layer: Magic Eden + OpenSea + Tradeport clients (2026-07-20)
`lib/nft/types.ts`, `lib/nft/magiceden.ts`, `lib/nft/opensea.ts`, `lib/nft/tradeport.ts`,
`app/api/nft/collections/route.ts`. Full detail in `STATE.md` 2026-07-20b. Summary:
- **Magic Eden (Solana)**: collection browse/detail/listings live-verified keyless.
  Buy-instruction endpoint needs `MAGICEDEN_API_KEY` (confirmed live, stubbed with a
  clear error).
- **OpenSea (EVM)**: only single-collection lookup is actually keyless (confirmed on
  retest — an initial "browse works keyless" read from research turned out not to be
  reproducible, see STATE.md's bug note). Browse/listings/buy all need
  `OPENSEA_API_KEY`.
- **Tradeport (Sui/Aptos/Movement)**: everything needs `TRADEPORT_API_KEY`, including
  browse — confirmed live (denies even GraphQL introspection without one). Query shapes
  in the code are an unverified best-guess pending real schema access.
- No UI wired up yet — this is the data-layer foundation, not a working buy flow.

### OpenSea API key obtained + browse live end-to-end (2026-07-20c)
OpenSea has an **instant, anonymous key endpoint** (`POST /api/v2/auth/keys`, no
signup) built for exactly this use case — obtained a real key live, added to
`.env.local`, confirmed `GET /api/nft/collections?chainFamily=evm` returns real
collection data through the actual running app. Full detail in `STATE.md` 2026-07-20c.
**This key is the low-limit/30-day agent tier — get a real account-based key
(opensea.io/settings/developer) before production traffic.**

**Magic Eden and Tradeport have no equivalent anonymous mechanism** (confirmed live —
Magic Eden's `/v2/auth/keys` 404s, docs confirm dashboard-login-only; Tradeport is
exclusively the Asana form). **Blocked on the user** — both require creating an account
tied to a real identity/email, which shouldn't be done without the user's own
credentials/consent:
- **Magic Eden**: sign in at the developer dashboard (docs.magiceden.io) →
  `MAGICEDEN_API_KEY`. Only gates buy-instructions; browse/listings already fully work.
- **Tradeport**: submit the Asana form (linked in `lib/nft/tradeport.ts`) →
  `TRADEPORT_API_KEY`. Gates everything on that vendor, including browse.

**Next once those land**: live-test Relay's `call`/`txs` primitive (still only
docs-verified), then buy-execution code.

### Rate limiting migrated to Upstash Redis (2026-07-20)
See `STATE.md` 2026-07-20 entry and `SECURITY.md` "RESOLVED gaps" #1 for full detail.
`lib/rate-limit.ts` now uses `@upstash/ratelimit` + `@upstash/redis`, falls back to
the old in-memory limiter when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are unset. Code done
and live-verified against the dev server; **still needs a real Upstash database
created and its credentials filled into `.env.local`/production env** before this is
actually active outside local dev.

## Pending / deferred (explicit decisions, not forgotten)

- **NFT: TON support via GetGems** — deferred 2026-07-20 by explicit user decision
  ("leave BTC and TON away at the moment"). Real gap identified in research (no other
  vendor covers TON), API fitness already confirmed (signable TON transfer buy tx, free
  public tier). Revisit after Phase 1 (ME+OpenSea+Tradeport) ships.
- **NFT: Bitcoin Ordinals/Runes support via UniSat** — deferred 2026-07-20, same
  decision. Real gap identified (Magic Eden's Bitcoin marketplace shut down, OpenSea has
  no Bitcoin support), API fitness already confirmed (PSBT-based signable buy tx,
  fallback Gamma/OKX if UniSat access is a problem). Revisit after Phase 1.
- **NFT: Tensor (Solana fallback)** — not urgent-blocking, but apply for its
  approval-gated access now in parallel with Phase 1 build work, since approval is a
  form-wait, not something that can be accelerated by more engineering time.
  **Real API application URL** (2026-07-20, from their own docs, not guessed):
  https://airtable.com/apppFpk6Ul9yiI6sw/pagCBazYyAewboZnT/form — approval-gated,
  scoped to "traders and market-makers," no self-serve option. Submitted by the
  user directly (not by Claude — same reasoning as Magic Eden/Tradeport: needs real
  contact/business info).
  **Open-source SDK finding (2026-07-20)**: Tensor pointed us at two npm packages
  while waiting on approval — `@tensor-oss/tensorswap-sdk` (legacy marketplace,
  pool-based buy/sell) and `@tensor-oss/tcomp-sdk` (compressed NFTs). Both are
  Anchor/JS SDKs for building/signing Solana transactions **directly against
  Tensor's on-chain programs — confirmed no API key needed for that part**
  (`buyNft`/`sellNft`/`computeTakerPrice`, per their README). **Does NOT solve the
  current gap** — neither SDK fetches marketplace data (listings/prices); that
  still needs the gated REST/GraphQL API, or per their README, their Discord for
  supplementary data (collection UUIDs, merkle proofs). Relevant later for
  buy-execution (skip the API key entirely for signing, once a listing is known
  from somewhere), not for today's browse/discovery gap.

- **Build-our-own-Solana-NFT-API feasibility (researched 2026-07-20, decision: no)**.
  Both Magic Eden's on-chain program ("M2", Apache-2.0, github.com/magicoss/m2) and
  Tensor's (TensorSwap/TCOMP, github.com/tensor-foundation) are public/open-source, so
  the blocker to self-indexing was never secrecy — it's the ongoing cost: a persistent
  background indexer (not serverless routes), a DB reconciling state continuously,
  separate parsers per marketplace (ME's fixed-price listings vs. Tensor's bonding-curve
  pools — different math), and silent, permanent breakage risk every time either team
  ships a new program version. Weeks-to-months to build, indefinite to maintain, and it
  doesn't even help buy-execution (still need their real instruction formats regardless
  of where listing data comes from). **Decision: don't build it** — the actual pain
  points are narrower and mostly solvable cheaply instead:
  - **Missing total supply (the exact gap hit in 2026-07-20i)**: solvable via **Helius
    DAS's `getAssetsByGroup`**, which returns a real `total` field per collection — we
    already pay for Helius RPC, likely zero new cost. **Not yet implemented** — real,
    low-effort next step for `lib/nft/magiceden.ts`'s collection stats gap.
  - **Magic Eden's rate limit**: apply for their free API key (raises the 120/min
    keyless cap) + add server-side caching (partially already done via `lib/cache.ts`).
  - **Tensor gated access**: still needs the approval form above, but **Shyft**
    (docs.shyft.to) already aggregates Magic Eden + Tensor + Sniper listings without
    needing Tensor's own approval — a real fallback while waiting. Note: SimpleHash, a
    similar productized option, is being wound down after a Phantom acquisition — don't
    build on it.

## Not yet scheduled

- **Universal Gas Tank — blocked, not started.** Real user pitch (custodial pre-paid gas
  balance, sponsored via paymasters). Every real implementation path needs one of: (a) a
  funded operational hot wallet this app's backend would custody on each sponsored chain
  (Solana fee-payer keypair, Sui gas-owner keypair — both real, standard sponsored-tx
  mechanisms, but real capital + key-security decisions, not something to spin up
  unilaterally), or (b) a real third-party paymaster account (Biconomy/Pimlico for the
  EVM chains) requiring signup + API keys only the user/business can obtain. Building the
  UI without either in place would ship either a non-functional button or, worse, a real
  deposit-accepting flow with no operational plan for the funds. Not started until one of
  those prerequisites exists.

- **ClickPay follow-ups** (`/pay`, shipped 2026-08-08h) — v1 is native-currency payment
  sources only (SOL, or the connected EVM chain's own native token). Real, separate
  follow-ups: (1) arbitrary SPL/ERC20 payment sources — needs a second exact-output hop
  chained backward from Relay's required origin amount, real but unproven anywhere in
  this app; (2) webhook delivery (signing, retries, a registration UI) for the pitch's
  "automated e-commerce status updates" use case; (3) custom payment handles
  (`click.pay/alex`) — needs a username-registration system that doesn't exist in any
  form today.

- **Portfolio Baskets — custom baskets + shareable creator links (Stage 3)** — Stage 1+2
  (`/basket`, 2 curated baskets, full execution flow via `executeSwapFlow()`) shipped
  2026-08-08e. Deferred: a build-your-own-allocation flow with a stateless,
  URL-encoded shareable link (real, buildable on the same Stage 1 core, just deferred
  to keep the first ship small), and the pitch's "creator earns a split on every
  bundle executed" idea — that one specifically needs a persisted, attributable
  basket identity (a `baskets` DB table) plus real fee-splitting/payout logic, a
  distinct monetization feature from the swap mechanics themselves. Not started.

- **Portfolio Baskets — Sui allocations** — same root gap as the Dust Sweeper's Sui
  dust: no Sui swap execution path exists anywhere in this app. Any basket wanting a
  Cetus/Sui-ecosystem allocation hits the same wall.

- **Bitcoin general swap support (Phase 2)** — shipped 2026-08-08, merged directly into
  the main `/swap` picker 2026-08-08d (superseding the earlier standalone
  `BtcSwapPanel`, now deleted). BTC<->SOL and BTC<->ETH swaps via a dedicated
  ChangeNOW-backed flow (`app/api/quote/btc` + `/preview`, `app/api/swap/btc/*`,
  `runBtcSwap()` in `app/swap/SwapPageClient.tsx`, migration
  `0018_btc_swap_changenow.sql`) — separate routes from the main Jupiter/Relay
  pipeline, not a branch inside it (ChangeNOW's custodial deposit-address model has no
  signable "leg 1" the way Jupiter/Relay do). Bitcoin is now selectable directly in
  `SwapPanel`'s chain picker (`BTC_CHAIN_ID` in `lib/chains/swapChains.ts`), gated to
  only pair with native SOL or native Ethereum ETH. Scoped to BTC<->SOL/ETH only (the
  two ChangeNOW currencies already integrated) — **BTC<->other EVM chains (MATIC,
  AVAX, Base/Arbitrum/Optimism native tokens) is a real, separate follow-up, not yet
  built.** Both ChangeNOW estimate modes are now live-verified and used: "direct"
  (forward, sell-amount-first — the main widget's UX) and "reverse" (exact-output,
  still used by the Sui NFT-purchase flow).

- **Dust Sweeper — Sui sweep support** — `/dust-sweeper` (shipped 2026-08-08) detects
  native SUI dust but cannot sweep it: no Sui swap execution path exists anywhere in this
  app yet (`SWAP_CHAINS` has no Sui entry). Building one is a separate, large effort.

- **Dust Sweeper — EVM full-wallet scan** — EVM dust detection is scoped to tokens this
  app's own curated list already knows about (same limitation `PortfolioDrawer` already
  discloses), not a true arbitrary-token wallet scan the way the Solana side is (which
  enumerates every real SPL account directly). A true EVM scan needs a wallet-indexer
  vendor (Alchemy/Moralis-style "get all token balances" API) — deliberately not added as
  a new dependency in the initial pass.

- **Cross-chain feature batch follow-ups (deferred from the 2026-08-07d pass, see
  `STATE.md`)** — Phases 1-7 (auto-refuel, NFT floor conversion, dust burner, portfolio
  drawer, Meme Radar, NFT collection socials, site-wide X link) all shipped and verified;
  these are the real, separate items flagged along the way, not silently dropped:
  - **Paying for an NFT with an arbitrary SPL token (e.g. BONK)** — `NftBuyModal.tsx`
    still hardcodes native SOL/ETH only. The backend param might accept another token but
    this has never been exercised — needs its own careful pass (real, untested risk), not
    bundled into an already-large batch.
  - **Meme Radar: real fresh-launch (minutes-old) detection** — v1 reuses
    `lib/chains/trending.ts`'s existing already-liquid trending data, not brand-new-token
    discovery. Building real fresh-launch detection is separate, higher-risk scope —
    newer tokens are exactly the highest-rug-risk category to be pushing a quick-buy
    button on; needs its own safety-first design pass.
  - **Meme Radar: EVM rows / EVM safety scores** — RugCheck.xyz is Solana-only; v1 Radar
    is Solana-only end to end (trending list, safety, quick-buy). Extending to EVM
    trending tokens needs either a second safety-score provider or an honest "Not
    available" column, plus revisits the (currently moot) gas-refuel micro-pill idea from
    the original audit for cross-chain EVM quick-buy rows.
  - **Magic Eden collection social links** — hit Magic Eden's rate limit mid-research this
    session, couldn't verify `project_url`/`twitter`/`discord`-equivalent field presence.
    `CollectionSocialsBar.tsx`/`NftCollection`'s social fields are vendor-agnostic already
    (see `lib/nft/types.ts`) — adding Magic Eden support is just wiring
    `lib/nft/magiceden.ts` once fields are actually live-confirmed, not a redesign.
  - **Portfolio drawer: multi-coin Sui balances** — `lib/chains/sui.ts` only has
    `getSuiBalanceMist` (native SUI). The drawer is honestly labeled "native only" for
    Sui; a real multi-coin Sui balance reader would need new research into Sui's coin
    object model, not a small addition.

- **Games Hub follow-ups (deferred from the 2026-08-07i pass, see `STATE.md`)** — `/games`
  shipped with one real game (Crash Dummy); these are the real, separate items flagged
  along the way, not silently dropped:
  - **Crash Dummy true in-page embedding** — currently launches externally
    (`embeddable: false`) because crash-dummy.xyz sends `X-Frame-Options: SAMEORIGIN`.
    Needs either the developer (@Degen_Bald_Boy) adding a CSP `frame-ancestors`
    allowlist entry, or sharing the actual built game files for blockchains.click to
    self-host (the real technical equivalent of how the original Miniclip worked). Can't
    currently reach him — real follow-up outside this build.
  - **Real admin CRUD UI + role system + upload storage for games** — none of these exist
    anywhere in this app today; V1 deliberately used content-as-code
    (`lib/content/games.ts`) instead, same pattern as blog/FAQ. Revisit only if outside
    communities start submitting games at real volume — not worth the new auth/RBAC/
    storage surface for one game.
  - **Chain filter on `/games`** — not meaningful yet with one chain-agnostic browser
    game; add once real multi-chain-tagged games exist.
  - **Recently Played / Favorites** — same `localStorage`-hook pattern already used by
    `lib/client/useRecentPairs.ts`/`useSavedAddresses.ts`, held for Phase 1.5 until
    there's a real multi-game catalog to make either useful.
  - **Ratings/reviews, wallet-aware launches, achievements/leaderboards** (Phase 2+) —
    each a real new subsystem; wallet-aware launches specifically need each game's own
    SDK cooperation to read a passed-in address — blockchains.click can't force this on
    a third-party game.

- **Blog tutorial-hub follow-ups (deferred from the 2026-08-07c blog audit pass, see
  `STATE.md`)** — the HowTo/FAQ JSON-LD, sticky TOC, route diagram, embedded swap
  widget, and OG chain-badge infrastructure from that pass is done and exercised by one
  real post; these are real, separate scope, not silently dropped:
  - **More full blog articles** — only `how-to-swap-sol-to-eth.mdx` was written this
    pass (to exercise the new infrastructure); the audit's other 5 title suggestions
    are content work, not blocked on anything technical. Write more when there's time
    for real, accurate per-post content (not fabricated speed/KYC claims).
  - **Comparison articles** ("Blockchains.Click vs. Jumper vs. deBridge") — same item
    as the SEO backlog below, needs real sourced competitor research.
  - **Annotated UI step screenshots** (numbered callout badges on real wallet
    popups) — needs actual product screenshots; no browser automation has been
    available in any session so far to capture them.
  - **Floating persistent referral banner** — a real, deliberate site-wide UI decision
    (persistent bars have real engagement/CLS downsides), not built by default. The
    example post uses a normal in-content `Callout` referral mention instead.
- **SEO/GEO follow-ups (deferred from the 2026-08-06 SEO pass, see `STATE.md`
  2026-08-06c)** — the `llms.txt`/JSON-LD/robots.ts/copy-correction work from that
  pass is done; these three are real, separate scope, not silently dropped:
  - **Programmatic per-pair swap route pages — Phase 1 DONE 2026-08-07, see
    `STATE.md`.** 12 Solana<->EVM chain-pair pages at `/swap/{chain}-to-{chain}`
    (SSG, real live quote widget + FAQ + JSON-LD per page), scoped deliberately to
    Solana-inclusive chain pairs only — full reasoning in the approved plan from that
    session (chain-pairs avoid the doorway-page risk token-pairs would carry; the
    full 7×6=42 chain matrix would include low-value EVM-to-EVM pairs this product
    has no real edge on). **Phase 2, still open**: token-level pair pages (e.g.
    `/swap/bonk-to-eth`, the audit's original example) — explicitly NOT built yet,
    gated on proving the 12 chain-pair pages actually get indexed/rank first, and
    needs a real content strategy to avoid thin/duplicate content at token-level
    scale (potentially hundreds of pages if built naively).
  - **Competitor comparison content** ("Blockchains.Click vs. Jumper vs. deBridge")
    — needs real, sourced research into competitors' actual current fee structures
    before writing anything; the audit's own assumptions about competitors aren't
    verified and shouldn't be published as fact.
  - **Third-party directory listings** (DefiLlama, DappRadar, CoinGecko) — needs
    accounts/verification on the user's end; not something to create unprompted.
- **NFT vendor API-dependency review (queued 2026-07-20, not started)** — bundles
  several related follow-ups, don't tackle piecemeal without checking this list:
  - **DONE (2026-07-21)**: ~~Helius DAS `getAssetsByGroup` for Magic Eden collection
    total supply~~ — built and live-verified, see `STATE.md` 2026-07-21. One
    correction along the way: the plain `total` field is bounded by `limit`, not the
    real collection size (contradicts what the original research summary implied) —
    needed `options.showGrandTotal: true` + the separate `grand_total` field instead,
    confirmed against Okay Bears' known ~10k supply. Magic Eden's Listed% now actually
    computes instead of permanently "—".
  - **Shyft as the Tensor fallback** — evaluate concretely (get a real quote for their
    listings/GraphQL product specifically, per the research's caveat that their public
    pricing page doesn't clearly cover it) as a way to get Tensor-covered Solana
    listings NOW, without waiting on Tensor's own approval-gated access.
  - General principle from the same research: don't build our own indexer for ME/
    OpenSea/Tensor — re-check that conclusion still holds before any future "let's
    just index it ourselves" impulse (see `STATE.md`'s indexer-feasibility entry for
    the full reasoning: both are technically public/parseable but the ongoing
    multi-marketplace parser-maintenance burden isn't worth it for narrow gaps).
- **NFT buy flow: same-chain purchase support + fee model review (queue item #2, DONE
  2026-07-21)** — see `STATE.md` 2026-07-21b for the full implementation writeup.
  - Same-chain (buyer already holds native ETH on the NFT's own chain) is now a real
    one-signature path: `NftBuyModal.tsx` has a "Pay with SOL"/"Pay with ETH" toggle,
    `quote`/`execute` routes branch on whether a Relay leg exists at all
    (`relay_quote === null`), `confirm-deposit` is skipped entirely, `confirm-buy`
    needed no changes.
  - **Fee decision made**: same-chain purchases carry NO platform fee (buyer pays
    exactly listing price + gas) — there's no cross-chain conversion/bridging service
    being provided on that path to justify the 0.25% fee that cross-chain purchases
    pay. Below stays for context on WHY no fee-sharing alternative was available.
  - **RESOLVED (researched 2026-07-20): no usable affiliate/referral fee program on
    any of the three.** None offers a Jupiter-Referral-Program-style "pass a
    parameter, earn a cut of their existing fee" mechanism:
    - **OpenSea**: no API affiliate parameter on `/v2/listings/fulfillment_data` or
      `/v2/offers/fulfillment_data`. Their old referral program was consumer-facing
      (share a listing link); the newer rewards/Waves program ended 2026-03-30. The
      one real option is **protocol-level, not an OpenSea program**: Seaport supports
      "tipping" — a fulfiller can append its OWN additional consideration/fee
      recipient when building the fulfillment tx. This would be OUR OWN extra fee on
      top, not a cut of OpenSea's 1% — and it's **unverified whether it survives
      OpenSea's restricted-order/zone validation** on orders sourced from their API.
      Needs real on-chain testing before relying on it, not just docs research.
    - **Magic Eden**: `/instructions/buy_now` accepts `buyerReferral`/
      `sellerReferral` wallet params, but no public docs define a commission/terms
      for third-party integrators — no signup flow, no stated cut. Worth a direct
      email to their BD/partnerships team to ask, not something to build against
      from docs alone.
    - **Tensor**: their referral program pays 5% of fees from users referred to sign
      up on Tensor's OWN site — tied to onboarding, not to API-executed trades.
      Doesn't apply to an aggregator like this app at all.
    - **Practical conclusion**: we cannot currently earn a cut of any of these
      marketplaces' own fees. The same-chain fee gap above still needs a decision —
      our options are (a) no fee on same-chain purchases, (b) our own fee via some
      non-Relay mechanism, or (c) the unverified Seaport-tipping route once tested.
- **NFT buy flow: first real signed transaction** — everything built in 2026-07-20o/p
  is quote/build-verified only, never exercised with a real wallet signature or real
  funds. Do a small/cheap real purchase before trusting this for arbitrary amounts.
- **NFT buy flow: origin chain/token picker** — V1 only supports paying in native SOL
  from Solana (`NftBuyModal.tsx`'s deliberate scope cut). A real Sell-side-style picker
  (mirroring `SwapPanel.tsx`) is the natural follow-up once the SOL-only path is proven
  live.
- `lib/cache.ts` has the same in-memory/single-instance limitation `rate-limit.ts`
  had — lower priority (cache miss, not a security gap), noted in `SECURITY.md`
  "Known open gaps" #1.
- No 2FA (SECURITY.md gap #2).
- EVM address validation is format-only, not EIP-55 checksum (SECURITY.md gap #3).
- EVM-origin cross-chain swap path (built 2026-07-18i) still needs live verification
  with a real browser + real EVM wallet + real funds (STATE.md 2026-07-18i).
- **External UX audit triage (added 2026-08-06) — IMPLEMENTED 2026-08-06, see
  `STATE.md` 2026-08-06.** User supplied a general Web3/DEX UX audit (hero trust
  signals, wallet UX, swap flow, NFT marketplace, navigation/gamification). Not all of
  it applied to this app's actual architecture; triaged against current build state
  before scheduling anything (kept below for the historical reasoning). All "Real
  gaps" items from both Part 1 and Part 2 below were built: real fee/route breakdown
  in the swap review step, a text-only trust bar, tagline rewrite, `/dashboard` nav
  link + homepage CTA, an interactive points calculator, and display-only tier badges.
  Not built (explicitly deferred per the triage, still open): manual dark-mode toggle
  UI polish beyond what already exists, live volume/tx counters (still gated on real
  traffic being large enough to be a credible signal), and the top-level
  Swap/NFT/Rewards tab restructure (solved more cheaply instead — a plain nav link,
  see above — the full IA overhaul was never actually necessary once `/dashboard` was
  just made discoverable).

  **Follow-up visual/motion audit — IMPLEMENTED 2026-08-06, see `STATE.md`
  2026-08-06b.** Gradient chain-color accent, cross-chain bridging beam on
  `SwapStepper`, tactile micro-feedback, 3D tilt on NFT cards, a points/referral
  side-card on the swap page, and a persistent activity drawer (recent pairs, saved
  addresses, session activity — localStorage-backed, not a server fetch). Rejected
  from that audit: wallet-status split pill (architecture mismatch, same as the
  dual-wallet indicator below), a tier-multiplier tracker (tiers stay display-only, no
  perk — see below), real vendor logos on the trust bar (stays text-only, no asset
  files exist), fabricated/PII-leaking "on-chain event toasts," and a full color-system
  rewrite + font swap (out of the approved scope).

  **New backlog item, not silently cut: real cross-device transaction-history
  endpoint.** The activity drawer's "Recent activity" section is currently
  session-local only (localStorage, persists across a reload but never synced across
  devices) — no `GET` route reads `swap_transactions` back for display anywhere in
  this app today, and building one means a new authenticated endpoint, a join against
  `swap_quotes` (token symbols/chain names live there, not on `swap_transactions`
  itself), and token-metadata resolution. Real feature, genuinely deferred as backend
  work rather than folded into the visual pass under a different name.

  **Already solved or reframed — don't build as described:**
  - "Dual-wallet Source/Destination indicator" — doesn't map onto this app's model.
    Identity is deliberately Solana-anchored with EVM as a linked-or-standalone
    signer (SIWS/SIWE, see `STATE.md` 2026-07-21). NFT buys already do a real
    two-signature flow (Relay delivers funds → wallet signs the buy directly). A
    generic dual-wallet-bar UI would need custom design work to fit this shape, not
    a drop-in.
  - "Destination address guardrails / ENS resolution" — lower value than the audit
    implies: this app doesn't have much manual-paste-destination-address flow (NFT
    buys use connected wallets); scope down if ever built.
  - "Progressive multi-step stepper for cross-chain latency" — cheap win, not a new
    feature: the NFT purchase state machine (`nft_purchase_quotes`/`nft_purchases`:
    deposit_pending → deposit_confirmed → ... ) already tracks every step this would
    visualize. Pure UI layer on data already collected.

  **Real gaps, priority order if picked up:**
  1. Fee/route breakdown transparency (platform fee vs gas vs slippage) — the real
     0.25%/same-chain-free fee logic exists but isn't well surfaced in the UI; this
     is a trust/legitimacy issue, not just polish.
  2. USD values + verified-token indicators in swap/NFT UI — cheap, no backend
     changes, high trust impact.
  3. Real stats counter (own tx/volume counts from the DB) — yes to real numbers,
     explicit **no** to the audit's suggestion of "audit badges" (OtterSec/CertiK/
     Trail of Bits logos) since this app has not been audited by anyone; don't
     imply otherwise.
  4. Points pill in header — points/referral system already exists server-side,
     just needs a small persistent UI counter.

  **Skip / defer, not worth building now:**
  - Slippage gear icon / manual routing controls — Relay/Jupiter already abstract
    this; exposing manual control adds support/risk surface without a clear ask.
  - Account abstraction / passkey onboarding, batch cross-chain NFT buys — no
    current signal these are needed, speculative scope.

  Nothing here is scheduled yet — revisit and move items into "In progress" if the
  user wants to act on the priority list above.

  **Part 2 (same day, 2026-08-06) — second batch of notes: IA/positioning, swap
  terminal mockup, trust signals, gamification, polish.** Same triage discipline —
  check against real current state before accepting a recommendation at face value.

  **Already solved, or the recommendation doesn't apply as stated:**
  - "No monospace/JetBrains Mono for numeric data" — already done. The
    2026-07-20g redesign added Geist Mono specifically for prices/amounts/
    addresses/swap IDs via a `.num` utility class (tabular-nums), same rationale
    the audit gives. No change needed; not worth swapping fonts without a reason.
  - "No dark mode / contrast" — already done (2026-07-20g), dark isn't an
    inverted light — accent was deliberately brightened for contrast on a
    near-black ground. Real gap that *does* still stand from that same rollout:
    no manual theme toggle exists, only `prefers-color-scheme`. Add one if a
    manual override is actually wanted.
  - "Security audit badges (CertiK/OtterSec/Trail of Bits)" — repeats Part 1's
    rejected item. Still no. Don't fabricate audit claims for audits that never
    happened.
  - "Dual-wallet header status pill (Source/Dest)" — same architecture mismatch
    as Part 1's version of this idea (SIWS/SIWE-anchored identity, not two
    peer wallets). Applies again here, not re-litigating.
  - "[1/3] → [2/3] → [3/3] loading stages during cross-chain execution" — same
    conclusion as Part 1's stepper item, but note the scope is now wider: this
    note is about the **swap terminal**, not just NFT purchases. The token-swap
    side has its own existing status states (`swap_transactions`/`swap_quotes`)
    that this can read from — still a UI layer on existing data, not new
    plumbing, but it's a second, separate stepper build (swap flow) alongside
    the NFT one already queued.

  **Real, net-new items worth considering (not covered by Part 1):**
  1. **"Powered by" trust bar with real routing-partner logos** (Jupiter, Relay
     — the app's actual, real dependencies) — legitimate version of the trust-bar
     idea, unlike audit badges. Don't list infra this app doesn't actually use
     (Wormhole/deBridge/Li.Fi/Pyth aren't integrated — verify against
     `AGENTS.md` before adding any logo, same "don't claim what isn't true"
     rule as the audit-badge rejection).
  2. **Route Details expandable panel** on the swap card (fee/gas/min-received
     breakdown) — this is the concrete UI shape for Part 1's #1 priority item
     (fee/route transparency), now with a real layout to build against instead
     of an abstract goal.
  3. **Tagline rewrite** — cheap copy-only change, no dependency on anything
     else. Current: "All the blockchains, in just one click." Proposed:
     something naming the fee + no-manual-bridging value explicitly. Worth
     doing whenever the hero section is next touched; not worth a dedicated
     pass on its own.
  4. **Top-level Swap / Cross-Chain NFTs / Rewards tab structure** — a real
     information-architecture question, not just styling: right now swap, NFT
     browse, and dashboard are separate pages/routes without a unified
     top-level switcher. Worth a real decision (not a silent adopt) since it
     touches `AppHeader` and routing broadly, not a single component. Flag for
     user decision before building.
  5. **Points/rewards dashboard tab with tier progression (Bronze/Silver/
     Diamond)** — net-new scope beyond Part 1's "points pill in header." The
     pill is cheap (server data already exists); **tiers are not** — there is
     no tier concept in the current points/referral schema
     (`points_ledger`/`referrals`), this would need real schema + threshold
     design work, not just a UI pass. Bigger than it looks.
  6. **Interactive points calculator** (slider → preview points/rebate) — pure
     frontend, can run entirely off the already-known 20%/10% referral split
     and existing volume-to-points conversion rate. Cheap, no backend
     dependency, fine to build independent of the tier-system item above.

  **Skip / low priority:**
  - EVM address format auto-detection (0x pasted into a Solana field) — same
    reasoning as Part 1's destination-address item: this app's flows are
    mostly connected-wallet-driven, not manual-paste-driven, so the failure
    mode this guards against is rare here.
  - Micro-interactions (pulse animation on route arrow, haptic feedback on
    mobile swap button) — pure polish, do last if at all, no functional value.
  - Live numeric counters ("$12.4M+ volume", "14s avg swap time") — legitimate
    *if* backed by real DB aggregates (same "real numbers only" rule as trust
    bar/badges above), but low priority until there's enough real volume for
    the numbers to be a credible trust signal rather than an obviously-small
    one.

  Still nothing scheduled — Part 1 + Part 2 together are the full triage of the
  external audit. Next real decision point is the IA/tab-structure question
  (item 4 above), since it affects scope of everything else in this list.

## Not yet scheduled (added 2026-08-08i)

- **Multi-chain stop-loss/take-profit starting FROM an EVM token** (part of the Trigger
  Orders pitch) — needs a real EVM limit-order protocol integration (1inch Limit Order
  Protocol, CoW Protocol) or the same custodial-auto-bridge blocker as the cross-chain
  delivery case below. Not researched this pass.
- **Cross-Chain "Bridge & Yield" Vaults** (part of the same pitch) — needs a real yield
  protocol integration (Aave, Ethena, etc.), not researched/verified.
- ~~Fully-unattended cross-chain Trigger Order delivery~~ — **shipped 2026-08-09** via
  bounded SPL delegate approval + a relayer service (`lib/relayer/*.ts`,
  `app/api/cron/deliver-orders`). See `STATE.md`/`SECURITY.md`'s 2026-08-09 entries. Only
  goes live once `RELAYER_SOLANA_SECRET_KEY` is set to a real, funded wallet — not
  fabricated by this session.
- **DCA delegation re-approval mid-schedule** — v1's 25% buffer is sized once at order
  creation; a schedule whose price drifts further than that falls back to the manual
  "Deliver now" flow for the excess rather than automatically re-approving a larger
  amount partway through. Real, scoped follow-up if this turns out to bite in practice.
- **Trigger Orders for arbitrary (non-SOL) Solana input tokens sold cross-chain**,
  webhook/push notification when a Trigger Order fills (currently the user must revisit
  `/orders` to see fill status and trigger delivery) — real, scoped follow-ups.
