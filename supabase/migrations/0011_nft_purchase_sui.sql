-- Extends nft_purchase_quotes to support Sui/Tradeport NFT purchases
-- alongside the existing OpenSea/EVM path, added 2026-07-21.
--
-- origin_chain_id (bigint) was NOT NULL and only ever held a numeric EVM
-- chain id or Relay's made-up SOLANA_CHAIN_ID — neither scheme has a
-- meaningful bigint for Sui, since Squid Router (the bridging engine for the
-- ETH-origin path — Relay has no Sui support at all, see lib/chains/squid.ts)
-- addresses Sui as the string "sui-mainnet", not a numeric id. Relaxed to
-- nullable + a new origin_chain_slug text column for this case, same
-- nullable-plus-check-constraint shape already used for
-- users.solana_pubkey/evm_verified_address (migration 0008) — a purchase
-- must have ONE of the two, never neither.
alter table public.nft_purchase_quotes
  alter column origin_chain_id drop not null,
  add column if not exists origin_chain_slug text,       -- non-numeric origin identifier, e.g. 'sui' (same-chain Sui purchase)
  add column if not exists move_chain text check (move_chain in ('sui', 'aptos', 'movement')),
  add column if not exists tradeport_listing_id text,     -- Tradeport's own listing id — what buyListings() actually keys off, distinct from token_id (the nft_id)
  -- Deliberately a SEPARATE column from relay_quote, not a reuse of it —
  -- this holds Squid Router's raw quote (see lib/chains/squid.ts), a
  -- different engine with a different response shape than Relay's. Only
  -- ever set for the ETH-origin cross-chain Sui path; null for same-chain
  -- Sui purchases (no bridging leg at all) same as relay_quote already is
  -- for same-chain EVM purchases.
  add column if not exists bridge_quote jsonb,
  -- The EVM address that signs the Squid origin-chain deposit — DISTINCT
  -- from dest_address (the buyer's Sui wallet, which receives the bridged
  -- SUI and separately signs the Tradeport buy). Needed so /execute can
  -- rebuild a fresh Squid route without trusting client-resupplied input for
  -- who the signer is. Only set for the ETH-origin cross-chain path; null
  -- for same-chain Sui purchases (no separate origin signer at all).
  add column if not exists origin_address text;

alter table public.nft_purchase_quotes
  drop constraint if exists nft_purchase_quotes_origin_chain_check;

alter table public.nft_purchase_quotes
  add constraint nft_purchase_quotes_origin_chain_check
  check (origin_chain_id is not null or origin_chain_slug is not null);

-- nft_purchases' existing status enum (pending, deposit_pending,
-- deposit_confirmed, listing_gone, buy_pending, complete, call_failed,
-- failed) already fits the Sui flow exactly as-is — "deposit" here means
-- Squid's ETH→SUI bridge delivering native SUI to the buyer's own Sui
-- wallet (cross-chain only; same-chain Sui purchases skip straight to
-- deposit_confirmed, mirroring the existing same-chain-ETH shortcut), "buy"
-- means the buyer signing Tradeport's buyListings() transaction with their
-- Sui wallet. No schema change needed there. deposit_tx_hash/dest_tx_hash
-- (both plain text) already fit an EVM tx hash on one leg and a Sui
-- transaction digest on the other without any change.
