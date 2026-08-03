-- Real bug found live 2026-07-21 while testing standalone EVM sign-in:
-- migration 0007's partial unique index (`... where evm_verified_address is
-- not null`) cannot be used as a Postgres ON CONFLICT arbiter through
-- Supabase's upsert() API — it generates a plain `ON CONFLICT
-- (evm_verified_address)` with no WHERE predicate, which Postgres refuses
-- to match against a partial index ("there is no unique or exclusion
-- constraint matching the ON CONFLICT specification"). Confirmed live: the
-- very first standalone-signin upsert failed with exactly that error.
--
-- Fix: a plain (non-partial) UNIQUE constraint. This is safe — standard
-- Postgres UNIQUE constraints already permit multiple NULL rows (NULL is
-- never considered equal to NULL), so the partial index's "only enforce
-- uniqueness among non-null values" behavior was redundant to begin with.

drop index if exists public.users_evm_verified_address_idx;
alter table public.users add constraint users_evm_verified_address_unique unique (evm_verified_address);
