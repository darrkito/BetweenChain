-- Replaces Squid Router with ChangeNOW for the ETH→SUI cross-chain NFT
-- purchase leg (2026-07-22) — Squid's Sui liquidity was real but too thin to
-- use (see STATE.md). `bridge_quote` (added in 0011 for Squid) is reused
-- as-is — it was already documented as vendor-agnostic ("Squid Router's raw
-- quote... a different engine" — now ChangeNOW's), no rename needed.
--
-- Two new columns specific to ChangeNOW's exchange-based model, which has
-- no equivalent in Relay/Squid's on-chain-bridge model:
alter table public.nft_purchase_quotes
  -- ChangeNOW's own exchange id — needed to poll /exchange/by-id for
  -- settlement status (see lib/chains/changenow.ts's getChangeNowExchangeStatus).
  add column if not exists bridge_exchange_id text,
  -- The deposit address ChangeNOW generates per-exchange — the buyer sends
  -- a PLAIN native-ETH transfer here (no contract call, unlike Relay/Squid's
  -- transactionRequest). Bound at execute time, same "never re-derive from
  -- later client input" rule as every other quote-bound value.
  add column if not exists bridge_deposit_address text;
