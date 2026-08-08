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

## ChangeNOW trust model (ETH/SOL/BTC → SUI NFT purchases)

The Sui NFT-purchase cross-chain path (`lib/chains/changenow.ts`, `app/api/nft/purchase/
sui/**`) uses ChangeNOW, not Relay/Squid — Relay has no Sui support. This deserved its own
entry here and didn't have one until this was noticed during the 2026-08-08 BTC-support
addition; documented now, not a new gap.

**Different trust model from Relay** — Relay is an on-chain bridge (the buyer's own wallet
calls a smart contract; cryptographic/contract guarantees move the funds). ChangeNOW is a
**custodial exchange**: the buyer sends ETH/SOL/BTC to a deposit address ChangeNOW
controls (a plain wallet-to-wallet transfer, no contract call), and ChangeNOW's own
systems send SUI to the payout address afterward, off-chain-matched. Real counterparty
risk — same category as using Coinbase/Binance to convert currency, not asserted to be
trustless. Still safe for this app's architecture specifically because it preserves the
core guarantee the two-signature NFT-buy design has always relied on: the buyer's own Sui
wallet is what ultimately holds the SUI and signs the Tradeport buy itself, so there's no
scenario where funds could be silently redirected mid-flow. If ChangeNOW simply never
delivers, the buyer is out whatever they sent — flagged explicitly, not glossed over.

`getChangeNowExchangeStatus` is polled server-side to confirm real settlement before ever
handing back a signable buy transaction — never trusts a client-reported deposit result,
same "never trust client-reported destination outcomes" rule as Relay's own
`getRelayIntentStatus` elsewhere in this app.

**Bitcoin origin added 2026-08-08** (via Xverse/sats-connect) — same trust model as
ETH/SOL, no new risk category. `sendTransfer` (sats-connect's real, current, non-
deprecated request method — its older `getAddress`/`sendBtcTransaction` callback pair are
marked `@deprecated` in the library's own type declarations, confirmed by reading them
directly rather than assumed from docs) sends a plain BTC payment, same "no contract call"
shape as the ETH/SOL deposit sends. Bitcoin has no separate sign-in/auth flow (mirrors
Sui's own pattern) — it's purely a payment rail, never the account identity.

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
   `Referrer-Policy` at all. Added a set in `next.config.ts`: `X-Frame-Options: DENY`
   (clickjacking protection — a real, known attack pattern against crypto dApps
   specifically: embed the whole app in an invisible iframe and trick a user into
   approving a transaction they think is something else), `X-Content-Type-Options:
   nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy:
   camera=(), microphone=(), geolocation=()`.
   **CORRECTION (2026-08-04, real live bug, user-reported)**: this originally also
   included `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri
   'self'` — deliberately without a `script-src` restriction, based on the (wrong, in
   this framework) assumption that an unspecified directive stays unrestricted. Confirmed
   live via the user's actual browser console: Next.js App Router auto-augments any
   user-supplied CSP header with its own `script-src`/nonce handling once a CSP is
   present at all, rather than leaving unspecified directives alone — this ended up
   blocking `eval()`, which wallet-adapter/viem's dependency chain uses internally
   (common in elliptic-curve crypto libraries). Result: wallet initialization crashed
   early enough in the provider tree to take the connect-wallet buttons AND the header
   nav buttons down with it — the exact "one crash near the root, whole app looks
   broken" pattern already seen once before in this codebase (the `data-theme` hydration
   bug in `app/layout.tsx`). Removed the CSP header entirely rather than special-casing
   `unsafe-eval` back in — the other four headers don't touch script execution at all and
   are confirmed unaffected. **Lesson**: this is exactly the failure mode the original
   entry warned about ("can't be safely tightened without live browser testing") — it
   still shipped anyway without that testing, and broke production. Don't re-add a CSP
   here without either (a) real browser testing against every wallet extension this app
   supports, or (b) at minimum a staging deploy checked by a human before going to
   production.
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
8. **`getMagicEdenWalletHoldings` (Games Hub ownership check, added 2026-08-07) built a
   wallet-address URL segment without `encodeURIComponent`** — inconsistent with every
   other Magic Eden call site in that file, which does encode. Found during the
   2026-08-08 full security review (below), fixed same day. Low severity on its own (a
   read-only lookup, no funds involved), but worth closing rather than leaving a
   URL-injection-adjacent inconsistency in place.

## 2026-08-08 — Full security review (user-requested: "check all the webs, the apis, the
processes")

Systematic pass: every API route's rate-limiting/auth coverage, the new Games Hub's
iframe attack surface, dependency vulnerabilities, and cross-referenced against current
(2026) real-world Web3 attack patterns (WebSearch: wallet-drainer techniques, iframe
sandbox escapes, npm supply-chain attacks on crypto packages). Summary — most of this
confirms existing protections still hold, a few new items below.

- **All 37 API routes have rate limiting** — verified via a full grep sweep (`rateLimit(`
  call present in every `route.ts` under `app/api/`), no gaps.
- **Auth coverage confirmed correct**: every route touching funds or private user data
  calls `requireSession()`; the unauthenticated routes (`/api/tokens/*`,
  `/api/quote/preview`, `/api/games/*`) are all pure reads/counters by design, matching
  the existing documented pattern for `/api/tokens/chains`/`/api/tokens/list` above.
- **`/api/img`'s SSRF protections re-verified intact**: protocol allowlist,
  private/loopback/link-local blocking (including the cloud metadata address
  `169.254.169.254`), re-checked on every redirect hop, size cap, content-type
  validation. Its own documented residual DNS-rebinding risk is unchanged and still
  accepted for the same reason (narrow blast radius — a rebound response still has to
  look like `image/*` to be returned).
- **Wallet-drainer pattern check (the #1 real-world attack vector right now per live
  research — unbounded `approve()`, Permit/Permit2 typed-data signatures disguised as
  normal swaps)**: this app never constructs its own token approval or signs any
  Permit/Permit2 message. The one "approve" step that exists in the swap flow
  (`lib/chains/relay.ts`'s `steps`) is Relay's own generated transaction, replayed
  verbatim — same "never reconstruct, always replay the vendor's real payload" trust
  boundary already established for every other quote/listing in this codebase (OpenSea
  Seaport fulfillment, Magic Eden buy instructions, Tradeport listings). Confirmed clean.
- **Games Hub iframe sandbox (`GamePlayer.tsx`) reviewed against a known real escape**:
  the `allow-scripts allow-same-origin` combination lets a framed document strip its own
  sandbox attribute and fully escape sandboxing — **but confirmed via research this
  specifically requires the framed content to be SAME-ORIGIN with the parent page**.
  Games are genuinely cross-origin (e.g. crash-dummy.xyz ≠ blockchains.click), so this
  escape does not apply as currently built. **Forward-looking note, not yet relevant**:
  if this app ever self-hosts a game's actual build files on its OWN domain (discussed
  with the user as the real technical path to true Miniclip-style embedding for a
  non-cooperating game — see `PLAN.md`'s Games Hub backlog), that would make the framed
  content same-origin and this exact escape would become live. Re-evaluate the sandbox
  flags (most likely drop `allow-same-origin`, or serve self-hosted games from a
  dedicated subdomain to keep them cross-origin from the main app) before ever doing
  that, don't carry today's sandbox config forward unchanged.
- **Supply-chain check**: cross-referenced this app's dependencies against the specific
  packages named in real, recent (2026) incidents targeting crypto wallets (Bitwarden
  CLI, an Injective SDK backdoor, the Mastra AI framework compromise) — none are
  dependencies of this app (`grep -i` across `package.json`/`package-lock.json`, zero
  matches). `package-lock.json` is committed (reproducible installs, not resolving to
  whatever a compromised registry might serve at install time).
- **New dependency risk, no fix available (same pattern as the already-documented
  `@solana/web3.js` chain)**: `@solana/spl-token` (added 2026-08-07 for the dust burner)
  transitively pulls in `bigint-buffer`, which has a real disclosed buffer-overflow CVE
  (`GHSA-3gc7-fjrx-p6mg`, high severity) with no patched release published yet
  (`npm audit` confirms `fixAvailable: false` for the underlying package; `spl-token` is
  already on its latest published version, `0.4.15`). Practical exploitability in this
  app's actual usage is narrow — it's invoked decoding real on-chain SPL token account
  data (via `getParsedTokenAccountsByOwner` and `@solana/spl-token` internals in
  `DustBurner.tsx`), not arbitrary attacker-supplied bytes under direct app control.
  Nothing actionable right now beyond monitoring for an upstream patch — do not force a
  downgrade/alternate-package swap without testing a real signed transaction against it
  first, same discipline already applied to the Tradeport SDK's `axios` CVE below.
- **One real bug found and fixed same-day**: see RESOLVED gap #8 above
  (`getMagicEdenWalletHoldings`'s missing `encodeURIComponent`).
- **One stale entry corrected**: see "Known open gaps" #3 below — EVM checksum
  validation was already fixed in a prior session but this file still listed it as open.

## Known open gaps (fix before meaningful volume)

1. **`lib/cache.ts` is still in-memory, single-instance** (token-list/trending/preview
   caching) — same limitation `lib/rate-limit.ts` had before the Upstash migration
   above. Not a security bug on its own (worst case is a cache miss, not data leakage
   across instances), but worth the same treatment if this ever runs multi-instance.
2. **No 2FA.** Supabase Auth's TOTP MFA can bolt on later without a schema change, but
   nothing enforces it today.
3. **~~EVM address validation is format-only~~ — already fixed, this entry was stale.**
   `lib/validation.ts`'s `isPlausibleEvmAddress` was upgraded to viem's `isAddress` on
   2026-08-03 (see that file's own comment) — it now enforces real EIP-55 checksum
   casing, not just `0x` + 40 hex chars. Found stale during the 2026-08-08 review below;
   corrected here rather than leaving a resolved item listed as open.
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
7. **Third dependency CVE, found 2026-08-08**: `bigint-buffer` (transitive via
   `@solana/spl-token`, added 2026-08-07 for the dust burner) — real disclosed
   buffer-overflow CVE (`GHSA-3gc7-fjrx-p6mg`, high), no patched release exists yet
   (`spl-token` is already on its latest version, `0.4.15`; `npm audit` confirms no fix
   available for `bigint-buffer` itself). Narrow practical exploitability in this app's
   actual usage — decodes real on-chain SPL account data, not arbitrary attacker-supplied
   bytes. Monitor for an upstream patch; same "don't force a blind downgrade of a
   money-adjacent dependency" discipline as item 6 above.
8. **Fourth dependency CVE, found 2026-08-08**: `valibot` (transitive via
   `@sats-connect/core`, added same day for Bitcoin/Xverse support) — a real disclosed
   ReDoS vulnerability in its `EMOJI_REGEX` validator (`GHSA-vqpr-j7v3-hqw9`, high). Client
   -side only (runs in the visitor's browser validating wallet responses, not this app's
   server) — a real hang risk for that one browser tab, not a server DoS or fund-loss
   vector. `npm audit`'s suggested fix is a MAJOR downgrade to `sats-connect@3.5.0` (two
   major versions back from the current, actively-published `4.2.1`) — not applied,
   same "don't force a blind dependency change on a money-adjacent library" discipline as
   items 6-7 above; a 2-major-version downgrade risks landing on a materially different,
   less-maintained API shape for no confirmed real-world exploitation path here.

## Explicitly out of scope

Any future capital-custody or automated-trading-agent product (mentioned in the original
spec as a "someday" idea — users locking funds for bots to trade) is **not** covered by
this threat model at all. That is a fundamentally higher-risk product surface and needs
its own security review before any code for it is written.
