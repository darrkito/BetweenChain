-- Real EVM-only sign-in (2026-07-21), on top of migration 0007's EVM-link.
-- Prior state: 0007 only let an EVM address LINK onto an existing
-- Solana-anchored session — a user with no Solana wallet at all could not
-- sign in, at all, full stop. Explicit user request: Ethereum should be
-- able to sign in completely on its own, no Solana wallet involved.
--
-- solana_pubkey therefore has to become optional — a user row can now be
-- anchored by EITHER identity (or both, once someone links the other chain
-- on top of whichever they signed in with first). The evm_link check
-- constraint guarantees a row is never anchored by neither.
--
-- IMPORTANT — this does NOT make every feature work EVM-only: the swap
-- engine's leg 1 always executes as a Solana transaction (Jupiter), and
-- several routes (app/api/quote, app/api/swap, app/api/swap/confirm) read
-- session.solanaPubkey directly and will correctly error for an EVM-only
-- session — that is an existing, deep architectural fact about how the
-- swap product works (see lib/pricing.ts's "every route passes through a
-- SOL checkpoint" comment), not something this migration changes. NFT
-- purchases with a non-Solana origin already worked without a Solana
-- session (see app/api/nft/purchase/quote/route.ts's isSolanaOrigin
-- branch) and continue to.

alter table public.users alter column solana_pubkey drop not null;
alter table public.users add constraint users_has_an_identity
  check (solana_pubkey is not null or evm_verified_address is not null);

-- A standalone EVM challenge has no user yet to attach to (that's the whole
-- point — the user doesn't exist until verify() finds-or-creates one), so
-- user_id must become optional too. 0007's link-mode challenges still set it.
alter table public.evm_auth_challenges alter column user_id drop not null;
