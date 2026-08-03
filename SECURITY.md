# Security model & threat log

This app moves real user funds across chains on **Solana mainnet**. Multiple real
transactions have been run and independently verified on-chain (not just trusted from
the database) — see `STATE.md` for the specific verification methodology used each time.
This doc tracks the threat model, what's closed, and what's explicitly still open — read
it before touching `app/api/quote`, `app/api/swap`, `app/api/bridge`, `lib/points.ts`, or
`lib/fees.ts`.

## Core threat: mid-transaction address tampering

**Scenario from the original product spec**: a user wants to swap SOL → ETH. An attacker
intercepts the request mid-flight and swaps the destination address, so the user's funds
land in the attacker's wallet instead.

**Mitigation**: `app/api/quote/route.ts` binds `dest_address` and `source_amount`
immutably into a single-use `swap_quotes` row at quote time. Every later step
(`/api/swap`, `/api/bridge`) reads the destination back from that bound row — it is never
accepted from client input again after the quote is created. A quote can only be consumed
once (`consumed_at`, race-guarded with a conditional update in `/api/swap`). This holds
regardless of which chain is the *origin* (see below) — only the destination side was
ever the security-critical binding, and non-Solana-origin support (2026-07-18i) didn't
change that.

**What is *not* bound**: the exact output amount. Cross-chain bridging can take minutes,
during which price moves — hard-binding output would make every quote expire before
execution. Output is governed by `slippage_bps` instead, checked at execution time. This
is a deliberate trade-off, not an oversight.

## Origin-address trust (2026-07-18i)

Non-Solana-origin quotes accept a client-supplied `sourceAddress` (the connected EVM
wallet's address), passed to Relay as the `user` field. This is **not** a MITM-style
security boundary the way the destination address is — but it does matter for *refund
safety*: if a cross-chain deposit fails after being sent, it's unconfirmed by Relay's
docs whether the refund goes to whoever actually signed the deposit tx on-chain (safe
regardless of what we declare) or to the declared `user` field (would matter if wrong).
Rather than resolve that ambiguity through documentation archaeology, the constraint is
enforced by construction: **the frontend must always populate `sourceAddress` by reading
it directly from the connected EVM wallet** (`evmWallet.address` in `page.tsx`) — never a
free-text field, never user-editable. If you're adding a new call site that builds a
quote request, do not add a manual "enter your address" field for this value.

## Auth: Sign-In with Solana, and standalone Sign-In with Ethereum

- Nonce-based challenge (`auth_challenges`), single-use (`consumed_at`), 5-minute TTL.
- The exact signed message text is persisted at issuance and replayed verbatim at verify
  time — **do not** regenerate the challenge message from `buildChallengeMessage()` a
  second time during verification; it embeds an `Issued At` timestamp that changes on
  every call, which will silently break every login (this exact bug was hit and fixed
  during initial build — see `STATE.md`).
- Session is a JWT signed with `SUPABASE_JWT_SECRET`, HttpOnly cookie, 7-day expiry.
- **Corrected 2026-08-03 (was stale — see below): there are now two independent ways to
  create an account/session**, both minting the exact same session shape
  (`lib/auth/session.ts`'s `requireSession()`):
  1. **Sign-In with Solana** (`lib/auth/siws.ts`) — the original mechanism, described
     above. `session.solanaPubkey` is set.
  2. **Standalone Sign-In with Ethereum** (`lib/auth/siwe.ts`'s
     `verifyEvmChallengeAndSignIn`, migration `0008_evm_standalone_signin.sql`) — a user
     with only an EVM wallet CAN create an account and sign in, with
     `session.solanaPubkey: null`. This superseded the older claim in this file (and in
     `AGENTS.md`'s "Origins beyond Solana" section) that an EVM wallet is "a signing tool,
     never an identity" — that's still true for the *link* flow (`verifyEvmChallengeAndLink`,
     attaching an EVM address to an already-Solana-authenticated session), but no longer
     true in general, since standalone sign-in exists as a separate path.
  - **Audited 2026-08-03, no bug found**: every route that needs a real Solana signer
    (`app/api/swap/route.ts`, `swap/confirm`, `quote`, `nft/purchase/quote`,
    `nft/purchase/sui/quote`) already explicitly checks `if (!session.solanaPubkey)` and
    returns a clear error before ever using it — an EVM-only session can't slip `null`
    through as if it were a valid pubkey anywhere. `lib/points.ts` (points/referral
    crediting) and `app/api/referral/route.ts` (invite codes, self-referral check) are
    both already `userId`-keyed throughout with zero Solana-specific assumptions, so they
    work identically for EVM-only accounts — nothing to fix there either.
  - `lib/auth/session.ts` also exports `requireSolanaSession()` for exactly this
    null-check purpose, but every existing call site does its own manual check instead
    (each needs a different status code / side effect on failure — e.g.
    `swap/route.ts` also marks the swap `leg1_failed` before returning). That's a
    deliberate choice, not an oversight — don't "simplify" these into
    `requireSolanaSession()` calls without checking each call site keeps its own
    error-response shape.

## Row-Level Security

- Every table has RLS enabled. The only client-reachable policies are `select_own`,
  scoped to `auth.uid()` (which resolves via the minted JWT's `sub` claim — see AGENTS.md
  auth model section).
- **No client-side insert/update/delete policy exists on any table.** All writes go
  through API routes using the service-role key (`supabaseAdmin()`), which bypasses RLS
  by design (`service_role` has `rolbypassrls = true`) — but every write path still
  requires an explicit `requireSession()` check in the route handler before it runs. RLS
  is not the write-authorization boundary here; the API route is.
- New tables need explicit `GRANT` statements (see `supabase/migrations/0002_grants.sql`)
  — recent Supabase versions do not auto-expose new tables to `anon`/`authenticated`/
  `service_role` even with RLS policies defined. Forgetting this produces "permission
  denied for table", not an RLS-style rejection — easy to misdiagnose.
- **As of `0014_revoke_direct_data_api_access.sql` (2026-08-03), `authenticated`/`anon`
  have ZERO grants on any table/view — the direct Supabase REST API (PostgREST) is fully
  closed off.** This was a deliberate hardening, not just a leak patch: `supabaseForUser()`
  (`lib/supabase/server.ts`) and `supabaseBrowser` (`lib/supabase/client.ts`) — the two
  client constructors that would ever use those grants — are confirmed dead code (grepped,
  never imported anywhere). Every real read/write in this app goes through an API route
  using `supabaseAdmin()` with its own explicit `.eq("user_id", session.userId)` filtering.
  Since there is no legitimate use for direct client-side Supabase access, there is no
  reason to leave that surface open at all — don't re-add an `authenticated`/`anon` grant
  to "let the client read this table directly" without re-deriving why this migration
  removed them first.
- `/api/tokens/chains`, `/api/tokens/list`, and `/api/quote/preview` are intentionally
  **public/unauthenticated** — pure market data and pricing with no user-specific
  content, no DB writes. Don't "fix" this by adding auth; it would break the stated
  purpose of the preview feature (quoting before a wallet is even connected).

## Points/referral fraud surface

- Points are only ever computed server-side, from on-chain-confirmed swap amounts, at
  `swap_transactions.status = 'complete'` — never from a client-supplied value
  (`lib/points.ts`). This is also true for the non-Solana-origin path (2026-07-18i) —
  the USD-volume computation there uses Relay's own quote-time `amountUsd`, not anything
  client-reported.
- `points_ledger.status` defaults to `'confirmed'` but exists specifically so a future
  fraud job can flag/reverse rows (wash trading, self-referral via alt wallets) without a
  schema migration. **No active detection exists yet** — this was an explicit scope
  decision for v1, not an accidental gap.
- `referrals.referred_user_id` is a primary key — a referral relationship is immutable
  once set, and self-referral is blocked at the DB level (`referrals_no_self_referral`
  check constraint).
- Minimum $1 volume floor (`MIN_VOLUME_USD_FOR_POINTS` in `lib/points.ts`) keeps
  dust/test swaps out of the ledger — confirmed working correctly in both directions on
  real swaps (a $0.75 swap correctly earned nothing, a $1.16 swap correctly earned 1
  point).

## RESOLVED gaps (previously listed here as open)

1. **CRITICAL, live security review 2026-08-03 — `public.user_points_balance` leaked every
   user's points balance to any signed-in user via direct Supabase REST access.** This is
   a VIEW over `points_ledger`. Postgres views execute with the privileges of their OWNER
   by default (the migration-applying role, which bypasses RLS) unless created with
   `security_invoker = true` — RLS enabled on the underlying `points_ledger` table does
   NOT protect a view built on top of it. **Confirmed live and exploitable**: a
   validly-signed `authenticated`-role JWT for a completely fake, non-existent `user_id`
   (no real account, no session ever issued) successfully retrieved a real user's actual
   points balance via `GET /rest/v1/user_points_balance?select=*` against the hosted
   Supabase project directly, fully bypassing this app's own API routes. Every OTHER table
   with a `select_own` RLS policy was verified NOT to have this problem (correctly
   returned zero rows for the same fake JWT) — this was isolated to the one view. Fixed in
   `0014_revoke_direct_data_api_access.sql`: `security_invoker = true` added to the view,
   AND (see the Row-Level Security section above) `authenticated`/`anon` grants revoked
   entirely across every table/view, since the direct-access client paths turned out to be
   completely unused dead code. Re-verified live post-fix: the same forged JWT now gets
   `403 permission denied` on every table/view, with zero change to the app's own
   functionality (confirmed `/api/points` and `/api/nft/collections` both still behave
   identically).
2. **Points/referral crediting had a real double-credit race condition** (`lib/points.ts`,
   both `creditSwapPoints` and `creditNftPurchasePoints`) — found in the same 2026-08-03
   review. The idempotency guard was check-then-act (`SELECT points_credited`, branch in
   application code, THEN `UPDATE`) — two near-simultaneous calls (trivial for a client to
   trigger: fire two parallel requests at `/api/swap/confirm` or any `confirm-buy` route
   with the same id) could both read `points_credited = false` before either write
   committed, and both would insert `points_ledger` rows, doubling the payout. Fixed by
   making the claim itself the atomic operation — `UPDATE ... SET points_credited = true
   WHERE id = $1 AND points_credited = false RETURNING id`; only the caller whose update
   actually affected a row (Postgres row-level locking serializes concurrent UPDATEs on
   the same row) proceeds to insert ledger rows. Proven with a real concurrency test
   (`lib/points.test.ts`'s `CONCURRENCY:` case, `Promise.all` of two simultaneous calls
   against real local Postgres, not a mock) — `IDEMPOTENCY:` (sequential retries) was
   already covered and stayed green; concurrent calls were not previously tested at all.
3. **Next.js was one patch version behind a set of real CVEs** — `16.2.10`, vulnerable
   range `>=16.0.0 <16.2.11`, included SSRF in rewrites via attacker-controlled destination
   hostname (HIGH), SSRF in Server Actions on custom servers (HIGH), middleware/proxy
   bypass (HIGH), cache confusion of response bodies (moderate — directly relevant given
   this app has several personalized API routes), and unauthenticated disclosure of
   internal Server Function endpoints (moderate). Upgraded to `16.3.0` (the current
   stable, non-major bump). `npm audit` confirms Next.js-specific advisories are gone;
   `tsc`/tests/lint/`next build` all still pass clean.
4. **Zero custom security headers anywhere** — confirmed via `curl -I` against production:
   only Vercel's own default `strict-transport-security` was present, no
   `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or
   `Referrer-Policy` at all. Added a deliberately conservative set in `next.config.ts`:
   `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` (closes
   clickjacking — a real, known attack pattern against crypto dApps specifically: embed
   the whole app in an invisible iframe and trick a user into approving a transaction they
   think is something else), `object-src 'none'`, `base-uri 'self'`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy: camera=(), microphone=(), geolocation=()`. **Deliberately did NOT**
   add a `script-src`/`connect-src` CSP — this app talks to many wallet extensions
   (Phantom/Slush/MetaMask inject their own scripts) and RPC/relay endpoints across
   several chains; tightening those without live browser testing against every one of
   them (no browser tooling was available in this session) risks silently breaking real
   wallet-signing flows. If browser testing ever becomes available, revisit this.
5. **~~Rate limiting was in-memory, single-instance~~ — fixed.** `lib/rate-limit.ts`
   now uses `@upstash/ratelimit` + `@upstash/redis` (sliding-window, Redis-backed) when
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set — shared across
   serverless instances/regions. Falls back to the old in-memory limiter when those env
   vars are unset (local dev without an Upstash database), which logs a warning if
   `NODE_ENV=production`. All 11 call sites across `app/api/**` updated to `await` the
   now-async `rateLimit()`. Live-verified against the running dev server (fallback
   path): 60/60s limit on `/api/tokens/chains` returned `200` for requests 1-60 and
   `429` for 61-62. `lib/cache.ts` has the same single-instance limitation, noted below,
   not yet migrated. **Still needs**: a real Upstash database created and its
   credentials set in `.env.local`/production env before this protection is actually
   active outside of local dev — see `.env.example`.
6. **~~`app/api/bridge/confirm/route.ts` trusted client-reported `destTxHash`/
   `destOutAmount`~~ — fixed.** It now independently verifies against Relay's own
   `/intents/status` server-side (`getRelayIntentStatus()` in `lib/chains/relay.ts`)
   before crediting anything or recording a tx hash. A malicious client can no longer
   fabricate a destination outcome.
7. **~~EVM-side Relay step execution wasn't wired into the UI~~ — built.** Two separate
   corrections were needed along the way, both real bugs, both documented in detail in
   `STATE.md`: (a) the Solana-origin cross-chain "deposit" step was incorrectly assumed
   to need EVM signing when it's actually always a Solana transaction regardless of
   destination chain; (b) a genuinely new EVM-origin signing path (`useEvmWallet.ts`) was
   then built for when the *origin* itself is non-Solana. Solana-origin cross-chain swaps
   have been run with real funds and verified on-chain (Arbitrum). The EVM-origin path is
   built and passes typecheck/lint/build and a real authenticated quote-generation test,
   but has **not yet** been exercised with a real browser + real EVM wallet + real funds
   — don't assume it's proven the way the Solana-origin path is.

## Known open gaps (fix before meaningful volume)

1. **`lib/cache.ts` is still in-memory, single-instance** (token-list/trending/preview
   caching) — same limitation `lib/rate-limit.ts` had before the Upstash migration
   above. Not a security bug on its own (worst case is a cache miss, not data leakage
   across instances), but worth the same treatment if this ever runs multi-instance.
2. **No 2FA.** Supabase Auth's TOTP MFA can bolt on later without a schema change, but
   nothing enforces it today.
3. **EVM address validation is format-only** (`lib/validation.ts`) — checks
   `0x` + 40 hex chars, not EIP-55 checksum casing. A malformed address fails on-chain
   rather than silently misdirecting funds, so this is low-severity, but worth upgrading.
4. **Relay-leg fee accrues off-chain and has never been claimed/withdrawn.** Not a
   security bug, but worth knowing before assuming the fee wallet's on-chain balance
   reflects reality — see `AGENTS.md`'s Fees section. Check
   `GET /app-fees/{address}/balances`, not the wallet's chain balance.
5. **Same-chain EVM-to-EVM swaps are blocked, not supported** (both UI and server-side,
   `/api/quote` returns 400) — this is deliberate scope, not a bug, but if that guard is
   ever removed, it needs its own verification pass first; Relay's same-chain-non-Solana
   aggregation behavior has never been tested.
6. **Two dependency CVE groups flagged by `npm audit` (2026-08-03), deliberately NOT
   force-fixed this pass**: (a) `@solana/web3.js` (moderate, pulled in by every
   `@solana/wallet-adapter-*` package) — `npm audit` reports `fixAvailable: false`, no
   patched version exists upstream yet; nothing actionable right now beyond monitoring.
   (b) `axios`/`analytics-node` (HIGH — a long list of CVEs: SSRF, prototype pollution,
   CSRF, credential leakage) — transitive via `@tradeport/sui-trading-sdk`, confirmed
   NOT directly imported/called by any app code (dead-path exposure only, unless the SDK
   itself makes an outbound call using axios during a real Sui buy). `npm audit`'s
   suggested fix requires a MAJOR version bump of `@tradeport/sui-trading-sdk` — the live,
   working Sui NFT purchase pipeline depends on this exact package; downgrading/upgrading
   it blind, without testing a real purchase against the new version, risks breaking a
   money-moving flow that currently works. Needs a dedicated pass: bump the SDK, run a
   real signed Sui purchase against it, confirm nothing broke, before touching this.

## Explicitly out of scope

Any future capital-custody or automated-trading-agent product (mentioned in the original
spec as a "someday" idea — users locking funds for bots to trade) is **not** covered by
this threat model at all. That is a fundamentally higher-risk product surface and needs
its own security review before any code for it is written.
