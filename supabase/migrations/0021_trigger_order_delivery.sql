-- Fully-unattended cross-chain delivery for Trigger Orders (2026-08-09) —
-- adds the state needed to track a bounded SPL delegate approval and the
-- relayer's own delivery execution, on top of the existing trigger_orders
-- table (migration 0020). See lib/relayer/*.ts and app/api/cron/deliver-orders
-- for what actually consumes these columns.
alter table public.trigger_orders
  add column if not exists delegate_amount numeric,
  add column if not exists delegate_tx_signature text,
  add column if not exists delivery_status text not null default 'manual'
    check (delivery_status in ('manual', 'pending', 'delivering', 'delivered', 'failed')),
  add column if not exists delivery_tx_signature text,
  add column if not exists delivery_error text;

-- Only orders that opted into automatic delivery (a real delegate approval
-- was signed) need to be scanned by the cron job — this partial index keeps
-- that scan cheap regardless of total order volume.
create index if not exists trigger_orders_pending_delivery_idx
  on public.trigger_orders (dest_chain_id)
  where delivery_status = 'pending' and cancelled_at is null;
