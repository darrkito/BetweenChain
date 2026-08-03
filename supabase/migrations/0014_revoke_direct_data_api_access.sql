-- CRITICAL FIX (2026-08-03, live security review): public.user_points_balance
-- is a VIEW over points_ledger. Postgres views execute with the privileges
-- of their OWNER by default (the migration-applying role, which bypasses
-- RLS) unless created with `security_invoker = true` — RLS enabled on the
-- underlying points_ledger table does NOT protect a view built on top of it.
--
-- Confirmed live and exploitable: a validly-signed `authenticated`-role JWT
-- for a COMPLETELY FAKE, non-existent user_id (no real account, no session
-- ever issued) successfully retrieved a REAL user's actual points balance
-- via `GET /rest/v1/user_points_balance?select=*` against the hosted
-- Supabase project directly — Supabase's auto-generated PostgREST API,
-- completely bypassing this app's own Next.js API routes and their
-- per-request `.eq("user_id", ...)` filtering. Every base table with a
-- `..._select_own` RLS policy was verified NOT to have this problem (RLS
-- correctly returns zero rows for a non-matching user on direct REST
-- access) — this was isolated to the one view.
--
-- Root cause of the wider exposure: `authenticated`/`anon` grants on every
-- table (added in 0002_grants.sql/0004_nft_purchase_grants.sql/etc, "for
-- future use" via `lib/supabase/server.ts`'s `supabaseForUser()` /
-- `lib/supabase/client.ts`'s `supabaseBrowser`) turned out to be COMPLETELY
-- UNUSED — grep confirms neither is ever actually called anywhere in the
-- app. Every real data read goes through an API route using the
-- service-role client with its own explicit authorization check. This means
-- the entire direct-PostgREST surface was pure attack surface with zero
-- legitimate use, so the fix here is defense-in-depth, not just a one-line
-- patch on the one view that happened to leak: revoke SELECT from
-- `authenticated`/`anon` on every table/view. If a future column/view is
-- ever added without correctly-scoped RLS (exactly the mistake that caused
-- this), there is now no grant for it to be reachable through at all.
--
-- RLS policies themselves are left in place (harmless, real defense-in-depth
-- if a grant is ever reintroduced deliberately later) — only the grants are
-- revoked.
revoke select on
  public.users,
  public.invite_codes,
  public.referrals,
  public.swap_quotes,
  public.swap_transactions,
  public.points_ledger,
  public.user_points_balance,
  public.nft_purchase_quotes,
  public.nft_purchases,
  public.evm_auth_challenges
  from authenticated;

-- Belt-and-suspenders: also make the view itself respect RLS on its
-- underlying table for any future caller (e.g. if a grant is deliberately
-- re-added for a legitimate reason later), rather than relying solely on
-- the grant being absent. Requires Postgres 15+ (Supabase's current
-- baseline).
alter view public.user_points_balance set (security_invoker = true);
