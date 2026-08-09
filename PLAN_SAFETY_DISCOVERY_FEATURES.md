# Safety & Discovery Features — research + plan (2026-08-09)

Seven pitches researched together: Airdrop Radar, GhostSwap, Evac Engine, Sentinel Shield,
OmniDust Vacuum, Estate Shield, Burner Shield. This doc is the "what's real, what's
buildable now, what order" analysis — no code written yet. Ranked easiest → hardest below,
with the reasoning that produced that order.

## How to read this doc
For each feature: **Real infra found** (live-researched, not assumed), **What's genuinely
buildable now** vs **what's blocked and why**, and **custody/compliance flags** — this app's
established discipline (see `SECURITY.md`, `PLAN.md`'s "Universal Gas Tank" entry) is to
never fabricate custody, compliance certifications, or credentials it can't actually obtain.
Every "blocked" item below is blocked for a *named, specific* reason, not vague caution.

---

## Ranking: easiest → hardest

| # | Feature | Difficulty | Why |
|---|---------|-----------|-----|
| 1 | GhostSwap | **Trivial–Easy** | Mostly a reframing of capability this app already has |
| 2 | OmniDust Vacuum | **Easy–Medium** | Reuses Dust Sweeper + the relayer built 2026-08-09, net-new piece is Permit2 |
| 3 | Evac Engine (manual v1) | **Medium** | Reuses swap engine + standard revoke; LP-unwind is real but protocol-specific |
| 4 | Airdrop Radar | **Medium–Hard** | Real discovery API exists (Drops.bot); claim EXECUTION is the hard, protocol-specific part |
| 5 | Sentinel Shield (read-only v1) | **Medium–Hard** | Aave health factor is a trivial read; automated repay is high-stakes and protocol-specific |
| 6 | Burner Shield | **Hard** | Needs real ERC-4337 account abstraction infra, new to this app |
| 7 | Estate Shield | **Hardest — likely needs real smart-contract development** | No existing protocol does "auto-transfer funds to beneficiaries"; SPL/ERC20 `approve` can't cleanly express "everything, forever" |

---

## 1. GhostSwap — trivial–easy — ✅ SHIPPED 2026-08-09

`lib/client/generateFreshWallet.ts` + `app/components/SwapPanel.tsx` — client-side
Solana/EVM keypair generation, private key shown once, never sent to the server. Blog
post: `content/blog/ghostswap-privacy-shielded-delivery.mdx`.

### Real infra found
Nothing new needed. This app's EXISTING cross-chain swap already works exactly the way the
pitch describes: Relay's solver receives the deposit on the origin chain and delivers the
output from **its own inventory** on the destination chain to whatever address is specified
— there was never a requirement that the destination address be "owned"/linked in this
app's UI. `app/swap/SwapPageClient.tsx` already lets you paste any destination address.

### What's genuinely buildable now
- A "Generate a fresh wallet" helper button next to the destination-address field —
  client-side keypair generation (`Keypair.generate()` for Solana, `generatePrivateKey()`
  from viem for EVM), private key shown once for the user to save themselves. Zero custody
  — this app never sees or stores it.
- UI copy/education explaining what IS and ISN'T severed (see compliance flag below) —
  this is genuinely most of the "build."

### Compliance flag — do not overclaim
- The pitch's mockup claims "Off-Chain Compliance Screening... Chainalysis / Elliptic
  APIs" — these are real paid enterprise products requiring an actual business
  relationship/contract this session cannot obtain. **Do not claim this exists in v1.**
- Do not market this as "anonymous" or "untraceable" — it only severs the *direct address
  link*; timing and amount correlation (the same heuristic clustering Chainalysis/Arkham
  actually use) can still connect the two wallets probabilistically. Honest copy:
  "breaks the direct on-chain link between your wallets," not "makes you anonymous."
- Same underlying mechanism as every cross-chain bridge already offers — this isn't a new
  *capability*, just explicit framing/UX for an existing one. Low implementation risk, but
  worth a deliberate, explicit decision (not a silent default) that the business is
  comfortable marketing this angle, given its association with mixer-adjacent messaging.

---

## 2. OmniDust Vacuum — easy–medium — ✅ SHIPPED 2026-08-09 (Solana-only v1)

Batch SPL delegate approval (`lib/relayer/delegateApproval.ts`'s new batch builder) +
relayer sweep/convert/return (`lib/relayer/deliverDustSweep.ts`), delivered by the SAME
daily cron as Trigger Orders (deliberately not a second `crons` entry — see STATE.md's
Hobby-plan cron incident). Migration `0022_dust_sweep_authorizations.sql`. UI:
`app/dust-sweeper/DustSweeperClient.tsx`'s "Vacuum with 1 signature" button. EVM/Permit2
still a real, scoped follow-up — not built this pass.

### Real infra found
- **Permit2** (Uniswap): confirmed live via BaseScan/Arbiscan/Etherscan/PolygonScan —
  canonical address `0x000000000022D473030F116dDEE9F6B43aC78BA`, deployed via CREATE2 at
  the *same* address on dozens of EVM chains (Ethereum, Arbitrum, Optimism, Polygon, Base,
  BNB, Avalanche, Blast, Linea, zkSync, Scroll, Celo, ...). This is the real "zero-gas
  permit batching" mechanism the pitch describes — a user signs an off-chain EIP-712
  Permit2 signature (no gas), and any relayer holding that signature can pull the approved
  amount on-chain, paying gas themselves.
- Solana already has its own real permit-adjacent flow: SPL `approve` (built 2026-08-09 for
  Trigger Orders' relayer — see `lib/relayer/delegateApproval.ts`), just not gas-free to
  *set* the approval (still needs one signed Solana tx) — acceptable, matches how Dust
  Sweeper already works today.

### What's genuinely buildable now
This is Dust Sweeper (`app/dust-sweeper/`) + the relayer pattern (`lib/relayer/*.ts`)
combined: instead of the user signing N swap transactions live, they sign ONE Permit2
batch-permit (EVM) or SPL approvals (Solana) covering their detected dust, and a cron job
(same pattern as `app/api/cron/deliver-orders`) sweeps it server-side via the relayer,
reusing the existing swap pipeline. Real, scoped, mostly composition of things this app
already has.

### What's blocked / needs a decision
- Same relayer-key custody model as Trigger Orders delivery — extends its existing blast
  radius (bounded per-approval) rather than introducing a new one. No new custody decision
  needed if reusing the same relayer.
- "Bulk Intent-Batching Solvers" (batching MANY USERS' dust into one settlement tx to
  compress gas) — real technique, but building a genuine multi-user batching solver is
  materially more infra than a per-user relayer sweep. v1 should do per-user relayer
  sweeps (still real automation, just not cross-user batched) and log true batching as a
  scale-later optimization.

---

## 3. Evac Engine — medium (v1 scoped to manual, no auto-triggers) — ✅ SHIPPED 2026-08-09

`/evac` (`app/evac/EvacClient.tsx`) — scans real (non-dust-capped) balances and evacuates
selected holdings to a safe-haven address via `executeSwapFlow`, plus a standalone
`approve(spender, 0)` revoke tool for a known token/spender. Refined during build: real
automatic approval DISCOVERY needs a paid indexer (Alchemy/Covalent/Etherscan) this
session has no credentials for — same category of blocker as prior features — so v1
points users to revoke.cash for discovery and handles execution only. LP/lending
unwind and auto-triggers remain real, scoped follow-ups.

### Real infra found
- Approval revocation is standard: `approve(spender, 0)` (legacy) or Permit2's own revoke
  path — no new capability needed, just building the revoke transaction.
- Approval **discovery** (which contracts a wallet has approved) has no single unified
  free API — Revoke.cash itself uses a mix of Alchemy, Covalent, and Etherscan-family APIs
  per chain (confirmed via their own README) — meaning any implementation here needs
  either (a) a paid indexer relationship per chain, or (b) direct `eth_getLogs` scans for
  `Approval` events against each connected wallet, which is real and free but slower and
  more RPC-intensive than a paid indexer.
- Aave v3's `getUserAccountData(user)` — confirmed live, standard on-chain view call, no
  auth, returns health factor directly. Real and trivial to read.

### What's genuinely buildable now (v1: manual "Evacuate now")
1. Scan connected wallets' approvals via `eth_getLogs` for `Approval` events (free, just
   RPC-intensive — cache aggressively).
2. Revoke each one (bundled instructions where possible).
3. Consolidate token balances to the user's specified hardware-wallet address via the
   EXISTING swap engine — this is functionally Dust Sweeper's "many → one" pattern again,
   just triggered manually in a panic scenario instead of routinely.
4. NO auto-withdraw from Aave/Uniswap LPs/Kamino/Navi in v1 — each is a separate protocol
   SDK integration (real work, not blocked, just sequenced later per protocol as its own
   scoped addition, starting with whichever protocol the user actually holds positions in).

### What's blocked / needs a decision
- **Automatic triggers** ("auto-evac if USDC depegs," "auto-evac on abnormal approval") —
  need the SAME unattended-relayer custody model as Trigger Orders, but for a much larger,
  less-bounded action (moving a user's ENTIRE portfolio, not one order's expected output).
  Should not ship without an explicit, separate custody-model conversation, same as this
  session required for Trigger Orders delivery.

---

## 4. Airdrop Radar — medium–hard — ⏸️ BLOCKED, skipped 2026-08-09

Confirmed at build time: Drops.bot's API key isn't self-serve (their docs say to contact
them on Twitter/X for one) — a real external dependency this session can't obtain, same
category as Universal Gas Tank's paymaster blocker. User explicitly chose to skip this
and continue to the next feature rather than ship an inert scaffold. Revisit once a
`DROPS_BOT_API_KEY` exists.

### Real infra found
- **Drops.bot has a real API** (`api.drops.bot/shared`, `x-api-key` header, key obtained by
  contacting them on Twitter — self-serve-ish, same "user must obtain a key" pattern as
  `CHANGENOW_API_KEY`/`TRADEPORT_API_KEY` elsewhere in this app) — marketing copy claims
  coverage across 8 networks including Ethereum, L2s, **Solana, and Sui**, matching this
  pitch's chain list closely. This is a real, existing discovery aggregator — building our
  own multi-protocol Merkle-tree indexer from scratch is NOT necessary.
- Bankless also has a real, documented Claimables API (EVM + Solana + Cosmos,
  token-authenticated, 300 req/min) as a second/fallback source.

### What's genuinely buildable now vs. unconfirmed
- **Discovery** (showing "you have $X unclaimed across these protocols") is real and
  buildable once an API key is obtained — this is the pitch's "scan" half.
- **Claim execution** is NOT confirmed to be a solved problem by these APIs: the docs
  fetched during this research didn't clarify whether Drops.bot returns ready-to-execute
  claim calldata/Merkle proofs per airdrop, or only eligibility/display data. **This must
  be verified with a real API key before promising "1-click claim" in the UI** — if it's
  eligibility-only, v1 should show "you have $180 of $DRIFT unclaimed — claim it here →"
  linking OUT to the protocol's own claim page, which is still a real, honest, valuable
  product (a "lost money" scanner) even without in-app execution.
- If calldata IS provided per-claim, in-app execution becomes buildable — but each
  protocol's claim asset then needs bridging/converting via the EXISTING swap engine to
  reach the user's preferred token, which is the easy part.

### Compliance/scope flag
- "2-3% platform fee on unclaimed airdrops" is a real, defensible monetization angle IF
  execution is in-app — cannot be charged on a pure "we told you where to go claim it"
  linkout flow. Fee model depends entirely on which capability tier gets built.

---

## 5. Sentinel Shield — medium–hard, read-only v1 strongly recommended — ✅ SHIPPED 2026-08-09

`/sentinel-shield` — Aave v3 `getUserAccountData()` across Ethereum/Arbitrum/Base
(`lib/aave/healthFactor.ts`). Pool addresses live-verified via direct `eth_call` before
hardcoding (not trusted from search results alone). Read-only, exactly as recommended —
no auto-repay. Kamino/Navi and automated action remain real, scoped follow-ups.

### Real infra found
- Aave v3 `getUserAccountData()` — confirmed, trivial, free, real-time health factor.
- Kamino (Solana) and Navi (Sui) each have their OWN on-chain state/SDK for reading
  positions — not researched in depth this pass; each is its own protocol integration,
  same pattern as Aave but not interchangeable code.

### What's genuinely buildable now (v1: monitoring + alerts only)
A dashboard showing live health factors across connected lending positions (Aave first,
since its read is confirmed simplest), with a configurable alert threshold — this alone
is real, useful, and appropriately scoped for a first pass at a genuinely high-stakes
product surface.

### What's explicitly NOT recommended for v1
- **Automated flash-repay / auto-deleverage** — this is the highest-consequence automation
  in the entire batch: a bug or a missed edge case doesn't just cost a fee, it can mean a
  real $2,500–$7,500 liquidation penalty either way (fails to fire in time = user gets
  liquidated anyway; fires incorrectly/drains the wrong reserve = separate real financial
  harm). This needs its own dedicated reliability/security review — including realistic
  failure-mode analysis (RPC outage during a crash, relayer under-funded at the exact
  moment it's needed, price oracle staleness) — before any code moves real collateral
  unattended. Recommend: ship read-only monitoring, gather real usage data, THEN scope
  automated action as its own project with its own review, not bundled into a v1 push.

---

## 6. Burner Shield — hard — ✅ SHIPPED 2026-08-09 as "Burner Shield Lite" (rescoped)

User explicitly chose the cheaper alternative this doc flagged over full ERC-4337
infra. `/burner-shield` — real pre-sign risk check backed by GoPlus Security's free,
no-API-key public API (`lib/goplus/security.ts`, confirmed live via direct `curl`):
address risk flags (phishing/theft/sanctions/mixer history) + token risk (honeypot,
buy/sell tax, mintable, owner-can-change-balance). EVM-only. Full ERC-4337 isolated
execution engine remains a real, scoped, NOT-built idea — see the reasoning above.

### Real infra found
- ERC-4337 account abstraction is real, mature infrastructure in 2026: Pimlico, Biconomy,
  ZeroDev, Alchemy, Coinbase Developer Platform, Stackup, Candide, Etherspot all offer
  real bundler/paymaster/account SDKs. Pimlico's `permissionless.js` is confirmed as the
  most widely-referenced open-source integration library; API keys are self-serve
  ("simply create an API key").
- Real transaction-simulation/drainer-detection products already exist (Blockaid, Wallet
  Guard, Tenderly) as a DIFFERENT, complementary mechanism (pre-sign warning, not
  post-sign isolation) — worth considering as a much cheaper v1 alternative (surface a
  Blockaid-style simulation warning before signing, rather than building full ephemeral
  account infrastructure) if the actual goal is "protect users from drainers," not
  specifically "ephemeral burner accounts."

### What's blocked / needs a decision
- This app has never integrated account abstraction before — this is genuinely new
  infrastructure (a new SDK dependency, a new signer flow, a paymaster relationship or
  reuse of this app's own relayer to fund burner gas).
- Funding burner gas for **arbitrary user-chosen target contracts** (the whole point of
  the feature — interacting with unverified/risky contracts) is a materially different
  risk profile than the bounded, known-destination relayer built for Trigger Orders — the
  relayer would be paying gas for interactions with contracts THIS APP has no way to
  vet in advance. Needs its own threat model before extending the relayer this way, or a
  real Biconomy/Pimlico paymaster relationship (same external-credential blocker pattern
  as Universal Gas Tank) instead of this app's own funds.
- EVM-only as pitched (ERC-4337 is EVM-specific) — no Solana equivalent researched.

---

## 7. Estate Shield — hardest, likely needs real smart-contract development

### Real infra found
- **Sarcophagus** is a real, live dead-man's-switch protocol on Ethereum — but it releases
  **encrypted DATA** (e.g., a seed phrase) on a missed check-in, via incentivized
  "archaeologist" node operators holding encrypted shares. It does NOT move funds itself —
  structurally a different mechanism than what this pitch wants (automatic fund sweep to
  beneficiaries). Confirms the underlying NEED is real and an established pattern exists
  for the "data reveal" version, but not for the "fund movement" version.

### Why this is architecturally hard, not just "more work"
- SPL/ERC20 `approve` (the bounded-delegation mechanism used for Trigger Orders and
  proposed for Evac/OmniDust) is inherently **per-token, per-amount, set at a point in
  time**. "Automatically protect and transfer ALL my current and FUTURE holdings for up
  to 180 days without me touching anything" cannot be cleanly expressed this way — the
  user would need to re-approve every time their portfolio composition changes, which
  defeats the "set and forget" premise the pitch is built on.
- The only ways to actually deliver the pitched behavior are: (a) this app holding real
  custodial control over the funds for the full inactivity window (explicitly the kind of
  "capital-custody product" `SECURITY.md`'s "Explicitly out of scope" section already
  flags as needing its own dedicated review before any code is written), or (b) a real,
  audited on-chain escrow/dead-man's-switch smart contract users deposit into directly —
  which means Rust (Solana) or Solidity (EVM) smart contract development, a security
  audit, and real deployment costs. That is fundamentally different work than anything
  else in this batch (or this app's history) — not a web-app feature, a protocol.

### Recommendation
Do not build this as a relayer/delegation feature — it will be dishonestly scoped if we
try (either underselling what it protects, or overselling a security guarantee bounded
approvals can't actually provide). If this is wanted, it should be scoped as its own
project: either commission real smart-contract development with a real audit budget, or
integrate with an existing fund-movement dead-man's-switch protocol if one is found in
future research (none confirmed this pass — Sarcophagus doesn't qualify). Logged here,
not silently dropped.

---

## Suggested build order
1. **GhostSwap** — ship first, nearly free, real value, needs one explicit compliance-copy
   decision from the business (see flag above).
2. **OmniDust Vacuum** — natural extension of Dust Sweeper + the relayer just built.
3. **Evac Engine v1 (manual only)** — real safety value, no new custody model needed.
4. **Airdrop Radar** — get a real Drops.bot API key first and verify the calldata question
   before committing to a scope/promise in the UI.
5. **Sentinel Shield v1 (read-only)** — ship monitoring, defer automation explicitly.
6. **Burner Shield** — only after deciding whether the real goal is "isolated execution"
   (needs AA infra) or "drainer warnings" (much cheaper — a Blockaid-style pre-sign check).
7. **Estate Shield** — do not build via this app's normal feature pipeline; needs its own
   smart-contract-development decision from the business first.

## Verification once any of these are approved for implementation
Same standing discipline as every feature this session: live-verify every third-party API
claim before writing code against it (especially the Drops.bot calldata question above),
`tsc`/`lint`/`test`/`build` clean before each commit, and — per the user's explicit
request — a full security/bug review pass across the whole site once a batch of these
ships, plus a new blog post per shipped feature (same `content/blog/*.mdx` pattern).
