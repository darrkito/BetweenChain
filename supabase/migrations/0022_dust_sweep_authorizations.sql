-- OmniDust Vacuum (2026-08-09, v1 — Solana only) — reuses the exact bounded
-- SPL delegate-approval + relayer pattern built for Trigger Orders
-- (migration 0021, lib/relayer/*.ts): the user signs ONE transaction
-- delegating the relayer to pull their EXACT current dust balance per
-- token (no buffer needed — the amount is a known, real on-chain balance
-- at authorization time, not an estimate), and the same relayer/cron
-- sweeps + converts to native SOL, delivered back to the user's OWN
-- Solana wallet. EVM (Permit2-based, genuinely zero-gas) is a real, scoped
-- follow-up — see PLAN_SAFETY_DISCOVERY_FEATURES.md.
create table if not exists public.dust_sweep_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_mint text not null,
  token_symbol text not null,
  token_decimals int not null,
  delegate_amount numeric not null,
  delegate_tx_signature text,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'delivering', 'delivered', 'failed')),
  delivery_tx_signature text,
  delivery_error text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dust_sweep_authorizations_user_idx on public.dust_sweep_authorizations (user_id);
create index if not exists dust_sweep_authorizations_pending_idx
  on public.dust_sweep_authorizations (id)
  where delivery_status = 'pending' and cancelled_at is null;

alter table public.dust_sweep_authorizations enable row level security;

create policy dust_sweep_authorizations_select_own on public.dust_sweep_authorizations
  for select using (user_id = auth.uid());

revoke select, insert, update, delete on public.dust_sweep_authorizations from anon, authenticated;
