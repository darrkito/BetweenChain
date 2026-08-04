-- SECURITY FIX 2026-08-04 — real fraud bug found in a security audit: the
-- confirm-buy routes (app/api/nft/purchase/{confirm-buy,magiceden/confirm-buy,
-- sui/confirm-buy}) only verified a client-reported tx hash succeeded
-- on-chain, never that it belonged to the SPECIFIC purchase being confirmed.
-- Two independent problems, both closed here:
--
-- 1. No unique constraint on dest_tx_hash meant the SAME successful tx
--    could be submitted against MANY different purchase rows, crediting
--    points unboundedly for each one. This constraint alone stops that.
-- 2. Even with the constraint, ONE unrelated valid tx could still fraudulently
--    complete ONE purchase. Closed at the application layer instead (see
--    lib/chains/{evm,solana,sui}.ts's new verify*BuyTx functions) — those
--    need the buy call's exact expected `to`/`value` for EVM, persisted here
--    at confirm-deposit time (the moment the fresh, staleness-checked buy
--    call is actually built) so confirm-buy has something real to check the
--    later-submitted tx against, instead of nothing.

alter table public.nft_purchases
  add column if not exists expected_buy_to text,
  add column if not exists expected_buy_value text;

-- Partial unique index (not a plain unique constraint) — dest_tx_hash is
-- null for every purchase until it actually completes, and a plain unique
-- constraint would treat multiple NULLs as a conflict under some Postgres
-- configurations depending on how it's declared; a partial index sidesteps
-- that ambiguity entirely by only indexing non-null values (same reasoning
-- already applied once before in this project for a different partial-index
-- gotcha, see migration 0009's comment on ON CONFLICT + partial indexes —
-- this one is a plain SELECT-time uniqueness guard, not an ON CONFLICT
-- target, so that specific gotcha doesn't apply, but the "only index real
-- values" principle carries over).
create unique index if not exists nft_purchases_dest_tx_hash_unique
  on public.nft_purchases (dest_tx_hash)
  where dest_tx_hash is not null;
