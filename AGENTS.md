<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Blockchains.Click

All the blockchains, in just one click. Cross-chain meme coin swap dApp, Relay.link-style UI. **Jupiter** converts SPL tokens to
native SOL (Solana leg only); **Relay.link** bridges from *any* chain to *any* chain
directly — Solana included, but no longer required as either endpoint. Sign-In with
Solana for auth (mandatory for every user, regardless of which chain they trade from),
Supabase/Postgres backend, points + referral growth system, a real platform fee. Built
against **Solana mainnet** — there is no devnet/testnet mode in this codebase, and
multiple real transactions with real funds have been run and independently verified
on-chain (see `STATE.md`).

See `data/project-notes-0717.txt` for the original voice-transcribed product spec,
`SECURITY.md` for the threat model, and `STATE.md` for dated build history — read
`STATE.md` before touching swap execution, fees, or the token-data pipeline; several
non-obvious bugs were found and fixed there and the fixes won't make sense without it.

## Mission-critical design constraint

Every swap must be quote-bound: the destination address and source amount are fixed
**at quote time** in `swap_quotes`, single-use, and never re-derived from client input
again. This is the direct fix for the MITM/address-swap scenario in the original spec
(an attacker intercepting a cross-chain transfer and swapping the destination address).
Any change to the swap flow must preserve this — never let a later step (leg 1, leg 2,
confirmation) accept a destination address from the client; always read it back from the
bound `swap_quotes` row. This holds regardless of which chain is the *origin* — see the
"Origins beyond Solana" section below.

## Architecture

```
app/
  page.tsx                    # swap UI: wallet connect (Solana + optional EVM), quote → sign → confirm → bridge
  dashboard/page.tsx          # points balance, invite code, redeem referral
  components/
    SwapPanel.tsx              # Sell/Buy cards, isBuyTokenAllowed() (Buy-side selection rules)
    TokenSelectModal.tsx       # two-column chain+token picker (both sides are multi-chain now)
    TrendingBar.tsx, TokenIcon.tsx
    EvmWalletButton.tsx         # minimal injected-wallet connect button
  api/
    auth/{challenge,verify}   # Sign-In-with-Solana
    auth/evm/{challenge,verify}  # Sign-In-with-Ethereum — link mode (session already exists) or standalone (mints a new EVM-only session), see SECURITY.md's auth section
    auth/session/route.ts     # lightweight "am I signed in" read (solanaPubkey + evmVerifiedAddress)
    quote/route.ts            # server-orchestrated quote, binds dest address + amount; branches on sourceChainId
    quote/preview/route.ts    # public, unauthenticated live pricing — mirrors quote/route.ts's branching
    swap/{route,confirm}      # leg 1: Jupiter SPL→SOL (Solana origin only), client signs only
    bridge/{route,confirm}    # leg 2: Relay origin→destination, resumable, server-verifies settlement
    tokens/{chains,list}      # cached chain/token-list data for the pickers
    referral/route.ts         # invite code create/redeem
    points/route.ts           # authenticated balance read
    nft/purchase/sui/{quote,execute,confirm-deposit,confirm-buy}  # Sui NFT purchase state machine — mirrors nft/purchase/{quote,...} above, ChangeNOW instead of Relay for the cross-chain leg (Relay has no Sui support)
lib/
  chains/
    jupiter.ts                 # Solana-only: SPL→SOL quote/swap-build, plus token search
    relay.ts                   # the general cross-chain execution engine — quote, execute, status, fees
    relayChains.ts, trending.ts, tokenList.ts  # token/chain data pipeline for the pickers
    changenow.ts                # ChangeNOW — ETH→Sui bridging ONLY (Relay can't reach Sui; a prior Squid Router attempt had no real Sui liquidity). CUSTODIAL exchange, not an on-chain bridge — read its top comment before touching
    sui.ts                     # server-side Sui RPC — isSuiTxSuccessful() mirrors evm.ts's isEvmTxSuccessful()
  auth/
    siws.ts                   # nonce issuance, ed25519 verify, Supabase-JWT minting
    session.ts                # requireSession() — reads/verifies the session cookie
  client/
    useAuth.ts                 # Solana sign-in
    useEvmWallet.ts             # viem + injected provider, signing tool only (see below)
    relayTransaction.ts         # Solana-side Relay deposit tx assembly (raw instructions + ALTs)
    amount.ts, constants.ts     # shared atomic-amount conversion, Solana sentinel normalization
  supabase/{server,client}.ts # service-role (bypasses RLS) vs anon (RLS-enforced) clients
  points.ts                  # points/referral ledger logic, server-only, idempotent, $1 min-volume floor
  pricing.ts                 # Solana-origin USD volume (SOL price lookup); non-Solana uses Relay's own quote-time USD value instead — see below
  fees.ts                    # platform fee config, both legs — see Fees section
  cache.ts, rate-limit.ts    # in-memory TTL cache / fixed-window limiter (single-instance, see notes)
  validation.ts               # EVM address format check
supabase/migrations/           # schema + RLS + grants, applied in order
```

## Origins beyond Solana (2026-07-18i)

The Sell side is **not** Solana-only. Relay's `/quote` accepts arbitrary origin tokens
directly on any supported chain — confirmed live, no Jupiter needed for non-Solana
origins. Two independent execution paths exist and must not be conflated:

- **Solana origin** (`sourceChainId === SOLANA_CHAIN_ID`): unchanged two-leg path —
  optional Jupiter leg (arbitrary SPL → SOL), then Relay leg if cross-chain. This is the
  original, most-tested path; don't touch it while working on the other one.
- **Non-Solana origin**: single-leg, Relay-direct. No Jupiter call exists or is possible.
  `app/api/swap/route.ts` marks `leg1_confirmed` immediately (nothing to convert) and the
  client goes straight to `/api/bridge`. The "deposit" step Relay returns is **on the
  origin chain**, always — for a non-Solana origin this is one or more real EVM
  transactions (`{from,to,data,value,chainId,...}`, ready to send, no assembly needed),
  and an ERC20 origin returns a separate leading `approve` step before `deposit` — iterate
  every step in order, waiting for each to confirm, via `lib/client/useEvmWallet.ts`.
- Same-chain EVM-to-EVM (e.g. USDC→ETH both on Ethereum) is explicitly unsupported —
  blocked both in the Buy-side picker (`isBuyTokenAllowed()` in `SwapPanel.tsx`) and
  server-side in `/api/quote` (a UI filter alone is bypassable via direct API calls).
- Session/account identity **within the swap flow described above** stays
  Solana-anchored — an EVM wallet here is purely a signing tool for the Sell-side deposit
  transaction when that side isn't Solana. **This is no longer true app-wide** (corrected
  2026-08-03, was stale): standalone Sign-In with Ethereum
  (`lib/auth/siwe.ts`'s `verifyEvmChallengeAndSignIn`, migration
  `0008_evm_standalone_signin.sql`) lets a user with only an EVM wallet create a real
  account and session (`solanaPubkey: null`) — they just can't originate a Solana-side
  swap leg with it, same as any session missing a Solana pubkey. See `SECURITY.md`'s auth
  section for the full picture (both sign-in paths, and confirmation that every
  Solana-signer call site already null-checks correctly).
- Points/USD volume pricing branches the same way: Solana-origin prices off leg1's SOL
  output (`lamportsToUsd`); non-Solana origins use Relay's own `details.currencyIn.amountUsd`
  from the stored quote instead — `lamportsToUsd` would silently misinterpret raw
  origin-token units as SOL lamports otherwise.

## Fees (2026-07-18c/d/h)

Two independent mechanisms, configured in `lib/fees.ts`, both default 25 bps (0.25%):

- **Jupiter leg**: `platformFeeBps` + `feeAccount` on `/quote` and `/swap`. `feeAccount`
  must be a token account for **wrapped SOL specifically** (the only mint this leg ever
  outputs), created once via referral.jup.ag. Settles **on-chain, immediately, per-swap**
  — verified live by querying the fee token account's balance directly.
- **Relay leg**: `appFees` on `/quote`, any EVM recipient address, no external setup.
  **Does not settle on-chain per-swap** — accrues in an off-chain USDC balance you claim
  whenever via `GET/POST /app-fees/{address}/...` or relay.link/claim-app-fees. Don't
  "verify" this fee by watching the recipient's on-chain balance — it won't move. Check
  the accrued balance endpoint instead. Verified live this way after initially (and
  reasonably) suspecting the fee wasn't working at all.

## Token-select modal data pipeline

`lib/chains/tokenList.ts` merges, per chain: Relay's `featuredTokens` (already ordered
native→USDC→USDT→other popular, confirmed live) + live trending (`lib/chains/trending.ts`:
Jupiter for Solana, GeckoTerminal for the mapped EVM chains) + search (Jupiter for
Solana, Relay for everything else — **not** the same source as trending/featured
validation logic, deliberately: Jupiter is the actual execution authority for Solana,
Relay for everything else, so each chain's data is sourced from whichever engine can
actually execute against it). A real, liquid, tradeable token can be completely absent
from Relay's index (it's scoped to bridging, not general discovery) while fully
searchable via Jupiter — this bit the search path once already, see `STATE.md`.

## Two-leg swap state machine

A cross-chain swap is (at most) two independent on-chain transactions with different
finality windows. `swap_transactions.status` tracks:

```
leg1_pending → leg1_confirmed → leg2_pending → leg2_confirmed → complete
                    ↓                  ↓
               leg1_failed        leg2_failed (resumable: retry /api/bridge
                                   with the same swapId, no need to redo leg1)
```

Points are credited only at `complete` (same-chain swaps skip straight there after
leg1), never from a client-reported value — see `lib/points.ts`. `leg1` is skipped
entirely (auto-marked confirmed) both for a same-chain Solana-SOL source *and* for any
non-Solana origin — same code branch, two different reasons.

## Auth model

We do **not** use Supabase's built-in `auth.users`/email flow. `lib/auth/siws.ts` mints
its own JWT signed with `SUPABASE_JWT_SECRET`, with `sub` = our internal `users.id`. This
is what makes Postgres RLS's `auth.uid()` resolve correctly against our own `users` table.
The session lives in an HttpOnly cookie (`SESSION_COOKIE_NAME`, default `sbc_session`).
This is the *only* account identity mechanism — see "Origins beyond Solana" above for
why an EVM wallet never substitutes for it.

## Local dev backend (current state)

This project runs against **local Supabase via Docker** (`npx supabase start`), not a
hosted cloud project — see `STATE.md` for why and how to migrate to cloud when ready.
Studio UI: http://127.0.0.1:54323. DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
`.env.local` also carries a dedicated Helius mainnet RPC (the public Solana RPC 403s
browser traffic after a few requests — do not revert to it).

## Commands

```bash
npm run dev                    # Next.js dev server, http://localhost:3000
npm run build && npm run start # production build
npm run lint                   # eslint
npx tsc --noEmit                # typecheck only

npx supabase start             # boot local Postgres/Auth/REST/Studio stack (Docker)
npx supabase stop               # stop it
npx supabase db reset           # drop + recreate local DB, reapply all migrations in order
```

## Conventions

- All Supabase **writes** go through `supabaseAdmin()` (service-role key) inside API
  routes, after an explicit `requireSession()` check — never rely on RLS alone as the
  authorization boundary for writes. RLS is the boundary for reads only.
- Every new `supabase/migrations/*.sql` file needs explicit `grant select/insert/...`
  statements for `service_role`/`authenticated` — Supabase no longer auto-exposes new
  tables to the Data API roles. See `0002_grants.sql` for the pattern.
- Route handlers validate input with `zod` and rate-limit with `lib/rate-limit.ts` before
  doing any work.
- Anything that touches an external swap/bridge/price API (Jupiter, Relay, GeckoTerminal)
  lives in `lib/chains/` or `lib/pricing.ts`, marked `server-only`, and is never called
  from client components.
- External APIs change without notice — `lib/pricing.ts`'s Jupiter price endpoint was
  silently retired mid-project and broke points crediting until caught live. When adding
  a new external call, prefer verifying it live (curl/test call) over trusting
  documentation or memory of how it used to work.
