-- Real Sign-In-with-Ethereum (EIP-4361-style personal_sign challenge),
-- 2026-07-21. Deliberately a LINK onto the existing Solana-anchored user,
-- not a second independent identity system: the account model documented in
-- STATE.md stays "a user with only an EVM wallet cannot use the app at all"
-- — every route below requires an existing Solana session (requireSession)
-- before it will issue or verify an EVM challenge. This just adds a
-- genuine, backend-verified proof that the connected EVM wallet is really
-- controlled by the same person as the signed-in Solana user, instead of
-- users.evm_default_address (unrelated, pre-existing column — that one is
-- just a last-used paste-in destination address, never signature-verified).

alter table public.users add column if not exists evm_verified_address text;
create unique index if not exists users_evm_verified_address_idx
  on public.users (evm_verified_address) where evm_verified_address is not null;

create table if not exists public.evm_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  evm_address text not null,
  nonce text not null,
  message text not null, -- exact signed text, persisted verbatim (embeds an
                          -- Issued-At timestamp, same reasoning as auth_challenges)
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists evm_auth_challenges_user_idx on public.evm_auth_challenges (user_id);

alter table public.evm_auth_challenges enable row level security;

-- Same pattern as every other table here: no client-side write policy at
-- all (only service_role, via API routes, ever mutates this). A user may
-- read their own challenge rows, though nothing in the UI currently needs to.
create policy evm_auth_challenges_select_own on public.evm_auth_challenges
  for select using (user_id = auth.uid());

grant select, insert, update, delete on public.evm_auth_challenges to service_role;
grant select on public.evm_auth_challenges to authenticated;
