-- As of recent Supabase versions, newly created tables are NOT auto-exposed
-- to the Data API roles (anon/authenticated/service_role) — only the "safe"
-- default privileges (TRUNCATE/TRIGGER/REFERENCES) are granted automatically.
-- Explicit grants are required for SELECT/INSERT/UPDATE/DELETE.

grant usage on schema public to service_role, authenticated;

-- service_role is our backend (API routes via supabaseAdmin()). It already
-- bypasses RLS (rolbypassrls=true) but still needs base table grants.
grant select, insert, update, delete on
  public.users,
  public.auth_challenges,
  public.invite_codes,
  public.referrals,
  public.swap_quotes,
  public.swap_transactions,
  public.points_ledger
  to service_role;

grant select on public.user_points_balance to service_role;

-- authenticated is the role embedded in our minted session JWT
-- (see lib/auth/siws.ts). It only ever needs SELECT — all writes go through
-- API routes using the service-role key — and RLS's `_select_own` policies
-- further restrict every row to the caller's own data.
grant select on
  public.users,
  public.invite_codes,
  public.referrals,
  public.swap_quotes,
  public.swap_transactions,
  public.points_ledger,
  public.user_points_balance
  to authenticated;
