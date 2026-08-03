-- SwapperBetweenChains initial schema
-- Auth model: wallet-signature login (SIWS). We mint our own JWT (signed with
-- SUPABASE_JWT_SECRET) after verifying the signature, so Supabase's built-in
-- auth.users table is NOT used — `auth.uid()` resolves to our own users.id via
-- the JWT `sub` claim, which is all RLS below relies on.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  solana_pubkey text not null unique,
  evm_default_address text, -- last-used paste-in EVM destination, convenience only
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- auth_challenges — short-lived SIWS nonces
-- ---------------------------------------------------------------------------
create table if not exists public.auth_challenges (
  id uuid primary key default gen_random_uuid(),
  solana_pubkey text not null,
  nonce text not null,
  message text not null, -- exact signed text, persisted verbatim (it embeds an
                          -- Issued-At timestamp, so re-deriving it at verify
                          -- time would never match what the client signed)
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_challenges_pubkey_idx on public.auth_challenges (solana_pubkey);

-- ---------------------------------------------------------------------------
-- invite_codes / referrals
-- ---------------------------------------------------------------------------
create table if not exists public.invite_codes (
  code text primary key,
  owner_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists invite_codes_owner_idx on public.invite_codes (owner_id);

create table if not exists public.referrals (
  referred_user_id uuid primary key references public.users (id) on delete cascade,
  referrer_user_id uuid not null references public.users (id) on delete cascade,
  invite_code text not null references public.invite_codes (code),
  created_at timestamptz not null default now(),
  constraint referrals_no_self_referral check (referred_user_id <> referrer_user_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id);

-- ---------------------------------------------------------------------------
-- swap_quotes — single-use, address-bound quote tokens
-- ---------------------------------------------------------------------------
create table if not exists public.swap_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source_chain text not null,           -- 'solana'
  source_mint text not null,            -- SPL mint address, or 'SOL'
  source_amount numeric not null check (source_amount > 0),
  dest_chain text not null,             -- 'solana' | 'ethereum' | 'base' | ... (Relay chain id/slug)
  dest_token text not null,             -- destination token contract address, or native symbol
  dest_address text not null,           -- IMMUTABLE once set — the MITM-prevention anchor
  slippage_bps int not null default 100,
  expected_output_min numeric,
  jupiter_route jsonb,                  -- cached Jupiter route for leg 1, if source_mint != SOL
  relay_route jsonb,                    -- cached Relay quote for leg 2, if dest_chain != 'solana'
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists swap_quotes_user_idx on public.swap_quotes (user_id);

-- ---------------------------------------------------------------------------
-- swap_transactions — two-leg state machine
-- ---------------------------------------------------------------------------
create table if not exists public.swap_transactions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.swap_quotes (id),
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'leg1_pending'
    check (status in (
      'leg1_pending', 'leg1_confirmed', 'leg1_failed',
      'leg2_pending', 'leg2_confirmed', 'leg2_failed',
      'complete'
    )),
  leg1_signature text,        -- Solana tx signature (Jupiter swap, or the only leg if same-chain)
  leg1_confirmed_at timestamptz,
  leg1_out_amount numeric,    -- actual SOL received from leg 1
  leg2_tx_hash text,          -- Relay execution tx hash on destination chain
  leg2_confirmed_at timestamptz,
  leg2_out_amount numeric,    -- actual destination token amount received
  usd_volume numeric,         -- computed at leg completion, drives points
  points_credited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists swap_transactions_user_idx on public.swap_transactions (user_id);
create index if not exists swap_transactions_quote_idx on public.swap_transactions (quote_id);
create index if not exists swap_transactions_status_idx on public.swap_transactions (status);

-- ---------------------------------------------------------------------------
-- points_ledger — append-only, fraud-schema-ready (status defaults to confirmed
-- in v1; no active fraud detection yet, but the column exists so a future job
-- can flag/reverse rows without a migration)
-- ---------------------------------------------------------------------------
create table if not exists public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  swap_id uuid references public.swap_transactions (id),
  points numeric not null,
  reason text not null check (reason in ('swap_volume', 'referral_bonus', 'referred_bonus', 'manual_adjustment')),
  status text not null default 'confirmed' check (status in ('confirmed', 'flagged', 'reversed')),
  created_at timestamptz not null default now()
);
create index if not exists points_ledger_user_idx on public.points_ledger (user_id);

-- balance view: only 'confirmed' rows count
create or replace view public.user_points_balance as
select user_id, coalesce(sum(points), 0) as balance
from public.points_ledger
where status = 'confirmed'
group by user_id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.invite_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.swap_quotes enable row level security;
alter table public.swap_transactions enable row level security;
alter table public.points_ledger enable row level security;

-- Users can only ever read their own row. All writes happen via the
-- service-role key from API routes, never directly from the client.
create policy users_select_own on public.users
  for select using (id = auth.uid());

create policy invite_codes_select_own on public.invite_codes
  for select using (owner_id = auth.uid());

create policy referrals_select_own on public.referrals
  for select using (referred_user_id = auth.uid() or referrer_user_id = auth.uid());

create policy swap_quotes_select_own on public.swap_quotes
  for select using (user_id = auth.uid());

create policy swap_transactions_select_own on public.swap_transactions
  for select using (user_id = auth.uid());

create policy points_ledger_select_own on public.points_ledger
  for select using (user_id = auth.uid());

-- No client-side insert/update/delete policies are defined anywhere above —
-- all mutations go through API routes using the service-role key, which
-- bypasses RLS intentionally. This is what prevents a client from ever
-- posting a fake points value or mutating a swap's destination address.
