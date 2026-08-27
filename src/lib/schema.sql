-- Run this in your Supabase SQL Editor

-- Profiles table (one row per user, auto-created on sign-up)
create table public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  username    text unique,
  created_at  timestamptz default now()
);

-- Secure it: users write only their own profile; the SELECT policy also lets
-- you read the profile of anyone you share a game with (defined in the
-- POLICIES section below, once game_players exists).
alter table public.profiles enable row level security;

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- GAMES
-- One row per match. board_layout stores the randomly generated
-- square-to-category assignments for that game.
--
-- board_layout is guaranteed at INSERT by the DB itself: NOT NULL with a
-- DEFAULT that generates a valid layout server-side (mirrors
-- src/lib/boardLayout.ts generateBoardLayout()). No client creation path — and
-- no future matchmaking RPC — has to synthesise one, and the client never
-- regenerates a live board. See supabase/2026-08-27-board-layout.sql.
-- ─────────────────────────────────────────────────────────────
create or replace function public.generate_board_layout()
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  cats       text[] := array['science','history','geography','entertainment','sports','art_lit'];
  hubs       text[];
  spoke_pool text[];
  spokes     jsonb := '[]'::jsonb;
  betweens   text[];
  i          int;
begin
  select array_agg(c order by random()) into hubs
  from unnest(cats) as c;

  select array_agg(c order by random()) into spoke_pool
  from unnest(cats || cats) as c;

  for i in 0..5 loop
    spokes := spokes || jsonb_build_array(
      jsonb_build_array(spoke_pool[i * 2 + 1], spoke_pool[i * 2 + 2])
    );
  end loop;

  select array_agg(c order by random()) into betweens
  from (select c from unnest(cats) as c order by random() limit 4) as picked(c);
  betweens := betweens || array['roll_again', 'roll_again'];
  select array_agg(b order by random()) into betweens
  from unnest(betweens) as b;

  return jsonb_build_object(
    'hubs',     to_jsonb(hubs),
    'spokes',   spokes,
    'betweens', to_jsonb(betweens)
  );
end;
$$;

grant execute on function public.generate_board_layout() to authenticated;

create table public.games (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'waiting'
                 check (status in ('waiting', 'active', 'completed')),
  winner_id    uuid references public.profiles(id) on delete set null,
  board_layout jsonb not null default public.generate_board_layout(),
  created_at   timestamptz default now(),
  constraint games_board_layout_shape check (
    jsonb_typeof(board_layout -> 'hubs')     = 'array' and
    jsonb_typeof(board_layout -> 'spokes')   = 'array' and
    jsonb_typeof(board_layout -> 'betweens') = 'array'
  )
);

alter table public.games enable row level security;

-- ─────────────────────────────────────────────────────────────
-- GAME PLAYERS
-- One row per player per game. Tracks position, which checkpoints
-- they've cleared, and whose turn it is.
-- ─────────────────────────────────────────────────────────────
create table public.game_players (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games(id) on delete cascade,
  player_id           uuid not null references public.profiles(id) on delete cascade,
  position            text not null default 'center',
  checkpoints_cleared text[] not null default '{}',
  turn_order          integer not null check (turn_order between 1 and 2),
  is_current_turn     boolean not null default false,
  joined_at           timestamptz default now(),
  unique (game_id, player_id),
  unique (game_id, turn_order)
);

alter table public.game_players enable row level security;

-- ─────────────────────────────────────────────────────────────
-- POLICIES
-- Added after both tables exist so cross-table references work.
--
-- Membership ("is the caller in this game?") is checked through a
-- SECURITY DEFINER helper. A plain subquery from game_players inside a
-- game_players policy makes Postgres recurse (error 42P17), which also
-- takes down every games / turns policy that reads game_players. The
-- read inside a definer function is not subject to RLS, so it can't
-- re-trigger the calling policy.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_game_member(p_game_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.game_players
    where game_id = p_game_id and player_id = auth.uid()
  );
$$;

-- Does the caller share any game with this other player? (Used to let
-- opponents read each other's profile / username.)
create or replace function public.shares_game_with(p_other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.game_players mine
    join public.game_players theirs on theirs.game_id = mine.game_id
    where mine.player_id = auth.uid() and theirs.player_id = p_other
  );
$$;

revoke all on function public.is_game_member(uuid)   from public;
revoke all on function public.shares_game_with(uuid) from public;
grant execute on function public.is_game_member(uuid)   to authenticated;
grant execute on function public.shares_game_with(uuid) to authenticated;

-- Profiles: your own, plus anyone you share a game with (so the opponent's
-- username resolves in GameScreen instead of falling back to "P2").
create policy "Users can view profiles in their games"
  on public.profiles for select
  using (id = auth.uid() or public.shares_game_with(id));

-- Games: a game you're in, or any game still waiting for an opponent
-- (matchmaking needs to see open games to join them).
create policy "Players can view their own games"
  on public.games for select
  using (status = 'waiting' or public.is_game_member(id));

-- Games: any signed-in user can open a new game.
create policy "Authenticated users can create games"
  on public.games for insert
  with check (auth.uid() is not null);

-- Games: only a member can mutate a game (status, board_layout, winner_id).
create policy "Players can update their games"
  on public.games for update
  using (public.is_game_member(id));

-- Games: a player can cancel their own game while it's still waiting
-- for an opponent (no opponent has joined yet).
create policy "Players can cancel their own waiting game"
  on public.games for delete
  using (status = 'waiting' and public.is_game_member(id));

-- Game players: members see all rows for their game; the roster of a
-- 'waiting' game is visible to everyone so an opponent can join.
create policy "Players can view game_players in their games"
  on public.game_players for select
  using (
    public.is_game_member(game_id)
    or exists (
      select 1 from public.games g
      where g.id = game_players.game_id and g.status = 'waiting'
    )
  );

-- Game players: you may only add yourself to a game.
create policy "Players can join a game as themselves"
  on public.game_players for insert
  with check (player_id = auth.uid());

-- Game players: each player can update only their own row
create policy "Players can update their own game_player row"
  on public.game_players for update
  using (player_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- MATCHMAKING
-- find_or_create_game() is the ONLY way the client starts a game. It runs
-- the whole find-or-create decision as one serialized, SECURITY DEFINER
-- transaction so two players tapping "Start Game" at the same time land in
-- the SAME game (P1 + P2) instead of each leaving an orphan 'waiting' game.
--
-- A global pg_advisory_xact_lock serializes all callers (the "no waiting
-- game exists -> create one" branch has no row to lock, so row locks alone
-- can't make it safe); FOR UPDATE SKIP LOCKED additionally steps over any
-- 'waiting' row locked by an unrelated tx. board_layout is generated
-- client-side (src/lib/boardLayout.ts) and passed in as p_board_layout.
-- Returns one row: (game_id uuid, is_player_one boolean).
--
-- Full definition + rationale: supabase/2026-08-27-matchmaking.sql
-- (prerequisite: supabase/2026-08-27-rls-realtime-fixes.sql).
-- ─────────────────────────────────────────────────────────────
create or replace function public.find_or_create_game(p_board_layout jsonb default null)
returns table (game_id uuid, is_player_one boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_game_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext('mind_marathon:find_or_create_game'));

  -- Caller already has a 'waiting' game — return it (guards a double-tap).
  select g.id into v_game_id
  from public.games g
  join public.game_players gp on gp.game_id = g.id
  where g.status = 'waiting' and gp.player_id = v_uid
  limit 1;

  if v_game_id is not null then
    game_id := v_game_id; is_player_one := true; return next; return;
  end if;

  -- Claim the oldest joinable 'waiting' game and join it as player 2.
  select g.id into v_game_id
  from public.games g
  where g.status = 'waiting'
    and not exists (
      select 1 from public.game_players gp
      where gp.game_id = g.id and gp.player_id = v_uid
    )
  order by g.created_at
  for update of g skip locked
  limit 1;

  if v_game_id is not null then
    insert into public.game_players (game_id, player_id, turn_order, is_current_turn)
    values (v_game_id, v_uid, 2, false);
    update public.games set status = 'active' where id = v_game_id;
    game_id := v_game_id; is_player_one := false; return next; return;
  end if;

  -- No joinable game — create one, caller is player 1. Omit board_layout when
  -- the caller didn't supply one so the column DEFAULT (generate_board_layout())
  -- applies — passing an explicit NULL would violate the NOT NULL constraint.
  if p_board_layout is not null then
    insert into public.games (status, board_layout) values ('waiting', p_board_layout)
    returning id into v_game_id;
  else
    insert into public.games (status) values ('waiting')
    returning id into v_game_id;
  end if;

  insert into public.game_players (game_id, player_id, turn_order, is_current_turn)
  values (v_game_id, v_uid, 1, true);

  game_id := v_game_id; is_player_one := true; return next;
end;
$$;

revoke all     on function public.find_or_create_game(jsonb) from public;
grant  execute on function public.find_or_create_game(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- QUESTIONS
-- The question bank. All generated by Claude.
-- category matches the 6 board categories.
-- ─────────────────────────────────────────────────────────────
create table public.questions (
  id             uuid primary key default gen_random_uuid(),
  category       text not null
                   check (category in ('science','history','geography',
                                       'entertainment','sports','art_lit')),
  body           text not null,
  correct_answer text not null,
  wrong_answers  text[] not null check (array_length(wrong_answers, 1) = 3),
  created_at     timestamptz default now()
);

alter table public.questions enable row level security;

create policy "Authenticated users can read questions"
  on public.questions for select
  using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────
-- TURNS
-- Full log of every move in every game.
-- question_id is null for roll-again squares (no question served).
-- ─────────────────────────────────────────────────────────────
create table public.turns (
  id                 uuid primary key default gen_random_uuid(),
  game_id            uuid not null references public.games(id) on delete cascade,
  player_id          uuid not null references public.profiles(id) on delete cascade,
  from_position      text not null,
  to_position        text not null,
  question_id        uuid references public.questions(id) on delete set null,
  answered_correctly boolean,
  created_at         timestamptz default now()
);

alter table public.turns enable row level security;

create policy "Players can view turns in their games"
  on public.turns for select
  using (
    exists (
      select 1 from public.game_players
      where game_id = turns.game_id and player_id = auth.uid()
    )
  );

create policy "Players can insert their own turns"
  on public.turns for insert
  with check (player_id = auth.uid());
