# ChainBreak

Cross-chain meme coin swap dApp: Solana-first, using **Jupiter** (SPL → SOL) and
**Relay.link** (SOL → any other chain/token) as the swap/bridge legs. Sign-In with
Solana for auth, points + referral system, Supabase/Postgres backend. Runs against
**Solana mainnet** — this is not a devnet/testnet build.

See `data/project-notes-0717.txt` for the original product note, and
`../.claude/plans/delegated-petting-wozniak.md` (if still present) for the full
architecture plan this was built from.

## Setup

1. **Supabase project**: create one at https://supabase.com, then in the SQL editor run
   `supabase/migrations/0001_init.sql`.
2. **Env vars**: `cp .env.example .env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
     — from Supabase project settings → API
   - `SUPABASE_JWT_SECRET` — from Supabase project settings → API → JWT Settings.
     This is what mints/verifies our custom Sign-In-with-Solana session tokens, and
     is what Postgres RLS's `auth.uid()` resolves against.
   - `NEXT_PUBLIC_SOLANA_RPC_URL` — a real RPC endpoint for production use. The public
     `api.mainnet-beta.solana.com` endpoint is fine for local dev but is rate-limited;
     use a dedicated provider (Helius, QuickNode, Triton) before going live.
3. **Install & run**:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000, connect a Solana wallet (Phantom or Solflare), sign in.

## Architecture

- `app/api/auth/{challenge,verify}` — Sign-In-with-Solana: nonce issuance, ed25519
  signature verification, mints a Supabase-compatible session JWT.
- `app/api/quote` — server-orchestrated quote (Jupiter leg + Relay leg), returns a
  single-use `quoteId` that **immutably binds the destination address and source
  amount** — this is what prevents mid-transaction address tampering.
- `app/api/swap` + `/confirm` — leg 1 (Jupiter: SPL → SOL). Client only ever signs a
  server-built transaction, never edits it.
- `app/api/bridge` + `/confirm` — leg 2 (Relay: SOL → destination). Resumable: if this
  leg fails or the user closes the tab, they can retry from the same `swapId` without
  re-running leg 1.
- `app/api/points`, `app/api/referral` — points ledger (`$1 volume = 1 point`, 20%
  referrer share, 10% referred bonus) and invite-code system. Points are only ever
  credited server-side after a swap reaches its final confirmed state — never from a
  client-supplied value.
- `lib/chains/{jupiter,relay}.ts` — the two external swap/bridge integrations.
- `supabase/migrations/0001_init.sql` — full schema + row-level security policies.

## Known v1 limitations (see code comments for detail)

- Uniswap is **not** integrated directly — Relay already routes through destination-chain
  DEX liquidity. Revisit only if a specific pair proves Relay can't cover it.
- Leg 2 (bridge) confirmation currently trusts client-reported `destTxHash`/`destOutAmount`
  rather than independently verifying against Relay's own status API — flagged in
  `app/api/bridge/confirm/route.ts` as a fast-follow before this handles real volume.
- No active fraud detection on the points ledger (wash trading, self-referral) — the
  schema is fraud-*ready* (`status` column on `points_ledger`) but nothing flags rows yet.
- No 2FA yet — Supabase Auth's TOTP MFA can bolt on later without a schema change.
- Rate limiting is in-memory, single-instance only — swap for `@upstash/ratelimit`
  (Redis-backed) before scaling past one deployment instance.
- Cross-chain (Relay) step *execution* in the UI is stubbed — same-chain Jupiter swaps
  are fully wired end-to-end (quote → sign → confirm → points), but signing/broadcasting
  the EVM-side Relay steps needs an EVM wallet integration (e.g. wagmi/viem) that isn't
  built yet. The backend orchestration (`/api/bridge`) is in place and ready for it.

## Deploying

Deploy to Vercel; keep the domain registered at GoDaddy and point its DNS (A/CNAME
records) at Vercel from the GoDaddy dashboard. Do not use GoDaddy's own hosting product
for this app.
