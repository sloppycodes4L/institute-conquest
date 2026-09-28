-- Institute Conquest: the permanent War Log. Every event of a war, whole (dice included), appended by the
-- edge function and read back only through it. Kept 90 days: no foreign key to ic_games, so the 30-day game
-- cleanup leaves the logs alone. Seq 0 is the war's meta row (players, map, and seat token hashes for access).
create table if not exists public.ic_logs (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  seq integer not null,
  event jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ic_logs_game_seq on public.ic_logs (game_id, seq, id);
create index if not exists ic_logs_created_at on public.ic_logs (created_at);

-- Server-only: RLS on and no policies, so neither the anon nor the authenticated role can touch it.
alter table public.ic_logs enable row level security;
comment on table public.ic_logs is 'Institute Conquest fan game: append-only War Logs, kept 90 days (server-only access).';

-- Append-only: rows can be added (and expired by age), never rewritten.
create or replace function public.ic_logs_no_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ic_logs is append-only';
end;
$$;
drop trigger if exists ic_logs_append_only on public.ic_logs;
create trigger ic_logs_append_only before update on public.ic_logs
  for each row execute function public.ic_logs_no_update();
