-- Push notifications v1 (2026-08-10 UX-audit follow-up — scope written in
-- PLAN.md's "Push notifications — feasibility check" entry, now built).
-- Standard Web Push (VAPID) subscription storage — one row per subscribed
-- browser/device per user (a user can have several: desktop + phone). The
-- endpoint/keys are exactly what the browser's PushManager.subscribe()
-- returns; nothing here is secret (a leaked endpoint alone can't send a
-- push without this app's own VAPID private key), but access is still
-- locked down server-side-only, same discipline as every other table in
-- this app since the 2026-08-03/2026-08-04 security hardening passes.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());

revoke select, insert, update, delete on public.push_subscriptions from anon, authenticated;
