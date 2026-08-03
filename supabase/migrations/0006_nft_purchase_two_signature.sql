-- Architecture correction (2026-07-20): the original nft_purchases design
-- assumed Relay's `call` primitive could execute the OpenSea Seaport buy
-- itself as one relayed intent. Real research found that's unsafe — Relay's
-- own docs confirm destination calls execute as Relay's Multicaller
-- contract, not the end user, and Seaport's fulfillment functions
-- unconditionally send the NFT to msg.sender with no recipient override.
-- Wrapping the buy in Relay's `call` would very likely strand the NFT in
-- Relay's contract. See STATE.md for the full research trail.
--
-- Corrected design: TWO signatures. (1) Relay delivers ETH to the buyer's
-- OWN EVM address (the same address that will sign step 2 — this is now a
-- real constraint, not an arbitrary "any recipient" field, since Seaport
-- requires msg.sender == NFT recipient). (2) That same wallet directly signs
-- and submits the Seaport buy transaction itself, so msg.sender is
-- genuinely the buyer. This is also safer on failure: if the listing sells
-- out during step 1's bridging delay, the buyer still has their ETH in their
-- own wallet — no stuck funds, they just don't get the NFT.

-- Listing identifiers needed to re-fetch FRESH fulfillment data right before
-- step 2 (not reuse a quote-time snapshot) — this is deliberately where the
-- listing-staleness re-check happens, since step 1's bridging delay is
-- exactly the window where a listing could sell out from under the quote.
alter table public.nft_purchase_quotes
  add column if not exists order_hash text,
  add column if not exists chain_slug text,   -- OpenSea's chain slug (e.g. "ethereum"), not a numeric id
  add column if not exists protocol_address text;

alter table public.nft_purchases
  drop constraint if exists nft_purchases_status_check;

alter table public.nft_purchases
  add constraint nft_purchases_status_check
  check (status in (
    'pending',            -- quote bound, awaiting step 1 (deposit) signature
    'deposit_pending',    -- step 1 submitted, awaiting Relay settlement
    'deposit_confirmed',  -- ETH landed in buyer's own wallet, ready for step 2
    'listing_gone',       -- re-checked before step 2 and the listing is no longer
                           -- available — buyer keeps their ETH, no funds at risk
    'buy_pending',        -- step 2 (Seaport buy) submitted, awaiting confirmation
    'complete',           -- step 2 confirmed, NFT delivered
    'failed'              -- step 1 itself failed/refunded
  ));
