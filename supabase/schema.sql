-- Run this once in your Supabase project: Dashboard > SQL Editor > New query.
-- Each account gets one row holding all of its Playtime data.
-- Row Level Security means a signed-in user can only ever reach their own row.

create table if not exists public.playtime_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.playtime_state enable row level security;

drop policy if exists "own row only" on public.playtime_state;
create policy "own row only" on public.playtime_state
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.playtime_state from anon;
grant select, insert, update, delete on public.playtime_state to authenticated;
