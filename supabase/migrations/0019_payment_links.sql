-- ---------------------------------------------------------------------------
-- payment_links — ClickPay invoices (2026-08-08). A payer's quote is a
-- completely normal swap_quotes row (see the added payment_link_id column
-- below) whose destination terms come from the invoice instead of being
-- typed by the payer — this table only holds the invoice itself, not any
-- payment state (payment status is derivable from whether a swap_quotes/
-- swap_transactions row referencing this link ever reached 'complete').
-- ---------------------------------------------------------------------------
create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: a link is still valid/payable even if we ever wanted to
  -- support anonymous link creation later; not used today (creation is
  -- session-required, see app/api/pay/create), but matches this app's
  -- existing "session optional at read time" pattern rather than assuming
  -- every future creator is authenticated.
  creator_user_id uuid references public.users (id) on delete set null,
  dest_chain_id int not null,
  dest_token text not null,             -- contract address, or native symbol
  dest_token_symbol text not null,      -- cached at creation, same convention swap_quotes' own cached fields use
  dest_token_decimals int not null,
  dest_token_logo_uri text,
  dest_address text not null,           -- IMMUTABLE once set — same MITM-prevention anchor as swap_quotes.dest_address
  amount_requested numeric,             -- null = open/any-amount ("donation link")
  label text,
  created_at timestamptz not null default now()
);
create index if not exists payment_links_creator_idx on public.payment_links (creator_user_id);

-- A ClickPay payment is just a swap_quotes row whose destination terms were
-- pre-filled from a payment_links row rather than typed by the payer at
-- quote time — no new state machine, reuses swap_transactions'/the existing
-- confirm/bridge routes' completion tracking unchanged.
alter table public.swap_quotes
  add column if not exists payment_link_id uuid references public.payment_links (id) on delete set null;
create index if not exists swap_quotes_payment_link_idx on public.swap_quotes (payment_link_id);

alter table public.payment_links enable row level security;

-- Same "every real read/write goes through an API route using the
-- service-role client, direct PostgREST is unused attack surface" posture
-- as every other table in this app (see migrations 0014/0016's hardening) —
-- a payer reading an invoice's terms happens via GET /api/pay/[id] (public,
-- unauthenticated, service-role-backed), never direct table access, so this
-- policy is defense-in-depth only, same role the swap_quotes policy plays.
create policy payment_links_select_own on public.payment_links
  for select using (creator_user_id = auth.uid());

revoke select, insert, update, delete on public.payment_links from anon, authenticated;
