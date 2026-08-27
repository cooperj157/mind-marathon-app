-- ============================================================================
-- 2026-08-27 — Atomic matchmaking (find-or-create in one server call)
-- Run in the Supabase SQL Editor. Fully idempotent — safe to re-run.
--
-- PREREQUISITE: supabase/2026-08-27-rls-realtime-fixes.sql must already have
-- been run (the is_game_member / shares_game_with helpers and the games /
-- game_players RLS policies it defines). This file only adds one RPC.
--
-- ---------------------------------------------------------------------------
-- The bug this fixes
-- ---------------------------------------------------------------------------
-- LobbyScreen.handleStartGame() used to:
--   1. SELECT games WHERE status = 'waiting'   (client-side)
--   2. if one was found  -> INSERT self as turn_order 2, UPDATE status='active'
--      if none was found  -> INSERT a new 'waiting' game + self as turn_order 1
--
-- Steps 1 and 2 are not atomic. Two players tapping "Start Game" within the
-- same window BOTH read "no waiting game" and BOTH create one. They never
-- match, and two orphan 'waiting' games are left behind. The slot-2 INSERT had
-- a 23505 retry loop, but the find-or-create *decision* itself was racy, and
-- the join + status flip were two un-transacted statements (a crash between
-- them stranded a full 2-player game in 'waiting').
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- One SECURITY DEFINER function that does the whole decision in a single
-- transaction, serialized so two racers deterministically land in the SAME
-- game (one as P1, one as P2):
--
--   * pg_advisory_xact_lock(<constant>) at the top. Every call to this
--     function serializes on one global key. This is the crucial part: the
--     "no waiting game exists -> create one" branch cannot be made safe with
--     row locks alone (there is no row to lock), so the whole find-or-create
--     runs under a mutex. The lock is transaction-scoped and auto-releases on
--     commit/rollback. Matchmaking is rare (a handful of friends), so a global
--     mutex costs nothing.
--
--   * Within the critical section:
--       - if the caller already owns a 'waiting' game, return it (so a
--         double-tap doesn't spawn a second orphan);
--       - else claim the oldest joinable 'waiting' game with
--         FOR UPDATE SKIP LOCKED, INSERT the caller as turn_order 2 /
--         is_current_turn false, and flip that game to 'active';
--       - else create a new 'waiting' game (board_layout supplied by the
--         client — see note below) with the caller as turn_order 1 /
--         is_current_turn true.
--
--   * Returns one row: (game_id uuid, is_player_one boolean).
--
-- board_layout: generated client-side by generateBoardLayout() in
-- src/lib/boardLayout.ts and passed in as p_board_layout. The shuffle logic
-- stays in one place (TypeScript) instead of being re-implemented in plpgsql;
-- GameScreen.load() still regenerates defensively if it is ever null/invalid.
-- The parameter is ignored on the join path (the P1 layout wins).
-- ============================================================================

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

  -- Serialize the entire find-or-create. Without this, two callers racing
  -- when NO 'waiting' game exists would both fall through to the create
  -- branch and produce two un-matchable orphan games. Transaction-scoped:
  -- released automatically on commit/rollback.
  perform pg_advisory_xact_lock(hashtext('mind_marathon:find_or_create_game'));

  -- 0. Caller already has a 'waiting' game of their own — hand it back
  --    instead of creating a duplicate (guards against a double-tap).
  select g.id
    into v_game_id
  from public.games g
  join public.game_players gp on gp.game_id = g.id
  where g.status = 'waiting'
    and gp.player_id = v_uid
  limit 1;

  if v_game_id is not null then
    game_id := v_game_id;
    is_player_one := true;
    return next;
    return;
  end if;

  -- 1. Claim the oldest joinable 'waiting' game the caller is not in.
  --    FOR UPDATE SKIP LOCKED is belt-and-suspenders under the advisory
  --    lock (the mutex already serializes us), but it also steps over any
  --    'waiting' game whose row is locked by an unrelated transaction.
  select g.id
    into v_game_id
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
    -- Join as player 2. The (game_id, turn_order) UNIQUE constraint can't
    -- collide here: the advisory lock means only one caller joins a given
    -- game at a time, and the status flip below removes it from this query
    -- for everyone after us.
    insert into public.game_players (game_id, player_id, turn_order, is_current_turn)
    values (v_game_id, v_uid, 2, false);

    update public.games
    set status = 'active'
    where id = v_game_id;

    game_id := v_game_id;
    is_player_one := false;
    return next;
    return;
  end if;

  -- 2. No joinable 'waiting' game — create one, caller is player 1.
  insert into public.games (status, board_layout)
  values ('waiting', p_board_layout)
  returning id into v_game_id;

  insert into public.game_players (game_id, player_id, turn_order, is_current_turn)
  values (v_game_id, v_uid, 1, true);

  game_id := v_game_id;
  is_player_one := true;
  return next;
end;
$$;

revoke all     on function public.find_or_create_game(jsonb) from public;
grant  execute on function public.find_or_create_game(jsonb) to authenticated;

-- ── Verify ─────────────────────────────────────────────────────────────────
--   -- two quick calls as two different signed-in users should return the
--   -- SAME game_id, is_player_one = true then false:
--   select * from public.find_or_create_game(null);
--
--   -- no orphan 'waiting' games should accumulate:
--   select id, status, created_at from public.games where status = 'waiting';
