-- ---------------------------------------------------------------------------
-- BTC general swap support (2026-08-08) — a BTC-involved swap on /swap uses
-- ChangeNOW (custodial deposit-address model, same engine already used for
-- BTC/ETH/SOL -> Sui NFT purchases), not Jupiter/Relay — neither of which
-- touch ChangeNOW at all. swap_quotes.jupiter_route/relay_route stay null
-- for these rows; the ChangeNOW-specific identifiers needed to create the
-- exchange and later poll its status have no existing column to live in.
-- ---------------------------------------------------------------------------
alter table public.swap_quotes
  add column if not exists changenow_rate_id text,
  add column if not exists changenow_estimate jsonb;

alter table public.swap_transactions
  add column if not exists changenow_exchange_id text,
  add column if not exists changenow_deposit_address text;
