-- SECURITY HARDENING 2026-08-04 (final security review pass) — migration
-- 0014 revoked SELECT from `authenticated` on every table/view (the role
-- the original leak's forged JWT used), reasoning that the entire direct-
-- PostgREST surface is unused attack surface since every real read/write
-- goes through an API route using the service-role client. That same
-- reasoning applies equally to `anon` — this app's real anon-role usage is
-- ALSO zero (grep confirms `supabaseForUser()`/`supabaseBrowser` are
-- unused dead code) — but 0014's revoke only listed `authenticated`,
-- leaving `anon` with full SELECT/INSERT/UPDATE/DELETE grants on every
-- table.
--
-- NOT currently exploitable for reads: live-tested directly against
-- production with the real anon key (no session, no JWT beyond the anon
-- key itself) against user_points_balance/swap_transactions/nft_purchases/
-- users — RLS correctly returned empty rows for all of them, same as a
-- forged authenticated JWT now correctly gets outright "permission denied"
-- (confirmed live too, proving 0014's fix genuinely holds). But leaving
-- `anon` grants in place is exactly the kind of latent, currently-RLS-
-- backstopped exposure 0014's own comment warned about: "if a future
-- column/view is ever added without correctly-scoped RLS... there is now
-- no grant for it to be reachable through at all" — that protection didn't
-- actually cover `anon`, only `authenticated`. Closing the gap for real.
revoke select, insert, update, delete on
  public.users,
  public.invite_codes,
  public.referrals,
  public.swap_quotes,
  public.swap_transactions,
  public.points_ledger,
  public.user_points_balance,
  public.nft_purchase_quotes,
  public.nft_purchases,
  public.evm_auth_challenges,
  public.auth_challenges
  from anon;
