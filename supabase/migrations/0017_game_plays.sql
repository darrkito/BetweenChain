-- Games Hub (2026-08-07) — minimal, real play-count persistence for
-- "Most Popular" sort + the count shown on a game card. Deliberately
-- separate from Vercel Analytics' track() events (also used for the same
-- funnel) — Analytics data is dashboard-only, not queryable back into this
-- app, so a number actually rendered on a page needs its own row here.
--
-- RLS enabled with NO grants to anon/authenticated, matching this project's
-- final security posture (see 0014_revoke_direct_data_api_access.sql /
-- 0016_revoke_anon_grants.sql): every real read/write goes through an API
-- route using the service-role client (lib/supabase/server.ts's
-- supabaseAdmin()), never direct PostgREST access — no policy is needed
-- here since no grant ever exists for anon/authenticated to use one.
create table if not exists public.game_plays (
  game_slug text primary key,
  play_count bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.game_plays enable row level security;

-- Atomic upsert-and-increment — called from app/api/games/[slug]/play/route.ts
-- via supabaseAdmin().rpc(). A plain read-then-write increment from the API
-- route would have a real (if narrow, at this traffic level) race window;
-- this does it correctly in one statement instead. `security definer` so it
-- can write despite RLS being enabled with no grants (see the table comment
-- above) — only ever invoked through the service-role client, same trust
-- boundary as every other write in this app.
create or replace function public.increment_game_play_count(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.game_plays (game_slug, play_count, updated_at)
  values (p_slug, 1, now())
  on conflict (game_slug)
  do update set play_count = game_plays.play_count + 1, updated_at = now();
$$;
