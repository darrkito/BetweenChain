-- Trigger Orders (2026-08-08) — Solana-native limit/price orders and DCA,
-- built on Jupiter's real Trigger + Recurring APIs (lite-api.jup.ag, no key
-- required). Jupiter's own on-chain program escrows the input token in a
-- PDA and Jupiter's own keeper network executes the fill when the price
-- condition is met — this table only caches what WE created, for listing
-- and for the "ready to deliver cross-chain" follow-up step. Jupiter's own
-- getTriggerOrders/getRecurringOrders stay the live source of truth for
-- status; this row is never mutated to reflect a fill, only read to render
-- the create/cancel UI and to know which filled orders still need their
-- cross-chain delivery step run.
create table if not exists public.trigger_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  jupiter_order_pubkey text not null,
  kind text not null check (kind in ('limit', 'dca')),
  input_mint text not null,
  input_symbol text not null,
  input_decimals int not null,
  output_mint text not null,
  output_symbol text not null,
  output_decimals int not null,
  -- limit orders: exact atomic amounts. DCA: total in + per-cycle amount/frequency.
  making_amount numeric,
  taking_amount numeric,
  cycle_amount numeric,
  cycle_frequency_seconds int,
  -- optional cross-chain follow-up: if set, once Jupiter reports this order
  -- filled, /orders offers a one-click "deliver to <dest_chain_id>" step
  -- reusing the existing executeSwapFlow — never auto-executed (no signer
  -- delegation exists in this app — see PLAN.md's Trigger Orders entry).
  dest_chain_id int,
  dest_address text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists trigger_orders_user_idx on public.trigger_orders (user_id);

alter table public.trigger_orders enable row level security;

create policy trigger_orders_select_own on public.trigger_orders
  for select using (user_id = auth.uid());

revoke select, insert, update, delete on public.trigger_orders from anon, authenticated;
