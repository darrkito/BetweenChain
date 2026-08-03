-- points_ledger.swap_id is a dedicated FK to swap_transactions — an NFT
-- purchase needs its own nullable FK column rather than overloading that
-- one, and its own `reason` value so points reporting can distinguish
-- "$1 volume = 1 point" earned via a token swap vs. an NFT purchase.

alter table public.points_ledger
  add column if not exists nft_purchase_id uuid references public.nft_purchases (id);

alter table public.points_ledger
  drop constraint if exists points_ledger_reason_check;

alter table public.points_ledger
  add constraint points_ledger_reason_check
  check (reason in ('swap_volume', 'nft_purchase_volume', 'referral_bonus', 'referred_bonus', 'manual_adjustment'));
