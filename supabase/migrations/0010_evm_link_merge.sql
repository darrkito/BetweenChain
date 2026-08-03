-- Real bug hit live 2026-07-21: a user who signs in with Ethereum BEFORE
-- ever connecting Solana gets a standalone EVM-only account (migration
-- 0008). If they later also connect + sign in with Solana in the same
-- browser, SIWS mints a brand-new, unrelated Solana-anchored account
-- (upsert-by-solana_pubkey has no idea the two belong to the same person).
-- Trying to "Sign in with Ethereum" again from that Solana session then
-- hits `verifyEvmChallengeAndLink`'s unique-constraint guard and fails with
-- "This Ethereum address is already linked to a different account" —
-- confirmed live: exactly this row existed
-- (evm_verified_address='0x6155bA22a5eac7C1f9185ea139901ABB8e2Af8c3',
-- solana_pubkey=null), orphaned from the user's own earlier standalone
-- sign-in.
--
-- Fix: when link mode's target address already belongs to a DIFFERENT
-- account that has NO Solana pubkey of its own (i.e. it can only be an
-- orphan created by exactly this scenario — a real second identity would
-- have its own Solana pubkey too), merge that orphan's data onto the
-- current session's user instead of rejecting. Single transactional
-- function (not several sequential JS calls) so a partial merge can never
-- happen.
create or replace function public.merge_evm_orphan_into_user(orphan_id uuid, keeper_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if orphan_id = keeper_id then
    return;
  end if;

  update public.swap_quotes set user_id = keeper_id where user_id = orphan_id;
  update public.swap_transactions set user_id = keeper_id where user_id = orphan_id;
  update public.points_ledger set user_id = keeper_id where user_id = orphan_id;
  update public.invite_codes set owner_id = keeper_id where owner_id = orphan_id;
  update public.nft_purchase_quotes set user_id = keeper_id where user_id = orphan_id;
  update public.nft_purchases set user_id = keeper_id where user_id = orphan_id;
  update public.evm_auth_challenges set user_id = keeper_id where user_id = orphan_id;

  -- referrals has a no-self-referral check constraint — reassigning either
  -- side onto keeper_id could make referred_user_id = referrer_user_id if
  -- keeper_id was already the other side of that same referral. Drop that
  -- row rather than violate the constraint; every other referral reassigns
  -- normally.
  delete from public.referrals
    where (referred_user_id = orphan_id and referrer_user_id = keeper_id)
       or (referrer_user_id = orphan_id and referred_user_id = keeper_id);
  update public.referrals set referred_user_id = keeper_id where referred_user_id = orphan_id;
  update public.referrals set referrer_user_id = keeper_id where referrer_user_id = orphan_id;

  delete from public.users where id = orphan_id;
end;
$$;

grant execute on function public.merge_evm_orphan_into_user(uuid, uuid) to service_role;
