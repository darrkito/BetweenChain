-- NFT purchase quotes + state machine.
--
-- Deliberately a SEPARATE pair of tables from swap_quotes/swap_transactions,
-- not a reuse of them — an NFT purchase binds to one specific marketplace
-- listing (which can be sold/cancelled out from under a quote) rather than a
-- fungible amount, and a listing's raw vendor payload must be replayed
-- verbatim into the buy call, same "never rebuild from user input" rule
-- already enforced for Jupiter/Relay quotes (see lib/chains/relay.ts).
--
-- Cross-chain EVM-destination buys (OpenSea via Relay's `call` primitive,
-- confirmed live 2026-07-20n) are a SINGLE relayed intent — the user signs
-- one origin-chain deposit, and Relay's solver network executes both the
-- bridge AND the destination marketplace-buy call itself. This means the
-- status flow below mirrors swap_transactions' single-deposit shape far more
-- than the two-signature Solana/Move buy pattern flagged in earlier NFT
-- research (that pattern still applies whenever the destination is Solana or
-- Move, since Relay's `call` primitive is EVM-only — not built yet, this
-- migration only covers the EVM/OpenSea path).

-- ---------------------------------------------------------------------------
-- nft_purchase_quotes — single-use, address-bound, listing-bound quote tokens
-- ---------------------------------------------------------------------------
create table if not exists public.nft_purchase_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  vendor text not null check (vendor in ('magiceden', 'opensea', 'tradeport')),
  chain_family text not null check (chain_family in ('solana', 'evm', 'move')),
  collection_slug text not null,
  token_id text not null,

  -- Listing price/currency AT QUOTE TIME — re-verified fresh against the
  -- vendor immediately before building the buy call (never trusted stale),
  -- but stored here for display and for detecting drift after the fact.
  listing_price numeric not null,
  listing_currency text not null,

  -- Where the buyer pays from — mirrors swap_quotes' source_chain/source_mint
  -- shape. origin_chain_id is Relay's chain id (matches
  -- lib/chains/relay.ts's SOLANA_CHAIN_ID convention for Solana).
  origin_chain_id bigint not null,
  origin_currency text not null,

  -- dest_address is the IMMUTABLE MITM-prevention anchor, same role as
  -- swap_quotes.dest_address — the wallet that will actually receive the
  -- purchased NFT, bound at quote time and never re-derived from later
  -- client input.
  dest_address text not null,

  -- The full Relay /quote/v2 response, replayed verbatim into /execute —
  -- same rule as relay_route on swap_quotes.
  relay_quote jsonb,
  origin_amount numeric,       -- how much origin_currency the quote requires
  origin_amount_usd numeric,

  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists nft_purchase_quotes_user_idx on public.nft_purchase_quotes (user_id);

-- ---------------------------------------------------------------------------
-- nft_purchases — state machine for a bound quote's execution
-- ---------------------------------------------------------------------------
create table if not exists public.nft_purchases (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.nft_purchase_quotes (id),
  user_id uuid not null references public.users (id) on delete cascade,

  status text not null default 'pending'
    check (status in (
      'pending',            -- quote bound, awaiting the origin-chain deposit signature
      'deposit_confirmed',  -- origin-chain deposit tx confirmed; relayed intent in flight
      'complete',           -- Relay intent status = 'success' — NFT delivered to dest_address
      'call_failed',        -- Relay intent status = 'fallback' — funds moved but the destination
                             -- buy call itself failed (listing sold/cancelled mid-flight, most
                             -- likely); buyer did NOT receive the NFT — needs its own recovery
                             -- messaging, distinct from a clean failure or a clean success
      'failed'               -- deposit itself failed, or Relay intent status = 'failure'/'refund'
    )),

  deposit_tx_hash text,          -- origin-chain deposit signature/hash
  deposit_confirmed_at timestamptz,
  relay_request_id text,         -- Relay's requestId, for polling /intents/status
  dest_tx_hash text,             -- destination-chain buy tx hash, once known
  dest_confirmed_at timestamptz,

  usd_volume numeric,            -- computed at completion, drives points same as swap_transactions
  points_credited boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nft_purchases_user_idx on public.nft_purchases (user_id);
create index if not exists nft_purchases_quote_idx on public.nft_purchases (quote_id);
create index if not exists nft_purchases_status_idx on public.nft_purchases (status);

-- ---------------------------------------------------------------------------
-- Row Level Security — same pattern as every other table: client can SELECT
-- its own rows only, all writes go through API routes with the service-role
-- key (bypasses RLS), never directly from the client.
-- ---------------------------------------------------------------------------
alter table public.nft_purchase_quotes enable row level security;
alter table public.nft_purchases enable row level security;

create policy nft_purchase_quotes_select_own on public.nft_purchase_quotes
  for select using (user_id = auth.uid());

create policy nft_purchases_select_own on public.nft_purchases
  for select using (user_id = auth.uid());
