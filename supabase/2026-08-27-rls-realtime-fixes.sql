-- ============================================================================
-- 2026-08-27 — RLS, realtime, and profile-visibility fixes
-- Run in the Supabase SQL Editor. Fully idempotent — safe to re-run.
--
-- Fixes three things found while play-testing a real 2-player game:
--
--   1. "infinite recursion detected in policy for relation game_players"
--      (Postgres 42P17). The game_players SELECT policy queried game_players,
--      so every read of games / game_players / turns failed with a 500 and
--      the lobby + matchmaking were dead. Route membership checks through a
--      SECURITY DEFINER helper whose internal read is not subject to RLS.
--
--   2. Players could never see each other's username. The profiles SELECT
--      policy was self-only, so GameScreen's `profiles(username)` join always
--      came back null for the opponent — "P1" / "Player 3F2A" forever, even
--      after username onboarding ships.
--
--   3. postgres_changes never fired (opponent's board only updated on reload).
--      The games / game_players / turns tables were never added to the
--      `supabase_realtime` publication.
-- ============================================================================


-- ── 1. Membership helpers ───────────────────────────────────────────────────

-- Is the caller a player in this game?
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

-- Does the caller share any game (past or present) with this other player?
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
    where mine.player_id = auth.uid()
      and theirs.player_id = p_other
  );
$$;

revoke all on function public.is_game_member(uuid)   from public;
revoke all on function public.shares_game_with(uuid) from public;
grant execute on function public.is_game_member(uuid)   to authenticated;
grant execute on function public.shares_game_with(uuid) to authenticated;


-- ── 2. profiles ────────────────────────────────────────────────────────────

drop policy if exists "Users can view their own profile"     on public.profiles;
drop policy if exists "Users can view profiles in their games" on public.profiles;
create policy "Users can view profiles in their games"
  on public.profiles for select
  using (id = auth.uid() or public.shares_game_with(id));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);


-- ── 3. games ───────────────────────────────────────────────────────────────

-- SELECT: a game you're in, or any game still waiting for an opponent.
drop policy if exists "Players can view their own games" on public.games;
create policy "Players can view their own games"
  on public.games for select
  using (status = 'waiting' or public.is_game_member(id));

-- INSERT: any signed-in user can open a new game.
drop policy if exists "Authenticated users can create games" on public.games;
create policy "Authenticated users can create games"
  on public.games for insert
  with check (auth.uid() is not null);

-- UPDATE: only a member can mutate a game (status, board_layout, winner_id).
drop policy if exists "Players can update their games" on public.games;
create policy "Players can update their games"
  on public.games for update
  using (public.is_game_member(id));

-- DELETE: cancel your own game while it's still waiting for an opponent.
drop policy if exists "Players can cancel their own waiting game" on public.games;
create policy "Players can cancel their own waiting game"
  on public.games for delete
  using (status = 'waiting' and public.is_game_member(id));


-- ── 4. game_players ────────────────────────────────────────────────────────

-- SELECT: every row for a game you're in, plus the roster of any 'waiting'
-- game (so matchmaking can find an open seat).
drop policy if exists "Players can view game_players in their games" on public.game_players;
create policy "Players can view game_players in their games"
  on public.game_players for select
  using (
    public.is_game_member(game_id)
    or exists (
      select 1 from public.games g
      where g.id = game_players.game_id and g.status = 'waiting'
    )
  );

-- INSERT: you may only add yourself to a game.
drop policy if exists "Players can join a game as themselves" on public.game_players;
create policy "Players can join a game as themselves"
  on public.game_players for insert
  with check (player_id = auth.uid());

-- UPDATE: you may only change your own row.
drop policy if exists "Players can update their own game_player row" on public.game_players;
create policy "Players can update their own game_player row"
  on public.game_players for update
  using (player_id = auth.uid());


-- ── 5. turns ───────────────────────────────────────────────────────────────

drop policy if exists "Players can view turns in their games" on public.turns;
create policy "Players can view turns in their games"
  on public.turns for select
  using (public.is_game_member(game_id));

drop policy if exists "Players can insert their own turns" on public.turns;
create policy "Players can insert their own turns"
  on public.turns for insert
  with check (player_id = auth.uid());


-- ── 6. Realtime publication ────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['games', 'game_players', 'turns'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- ── Verify ─────────────────────────────────────────────────────────────────
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime';
--   select schemaname, tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' order by tablename, cmd;
