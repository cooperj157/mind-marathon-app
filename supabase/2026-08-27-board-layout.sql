-- ============================================================================
-- 2026-08-27 — board_layout: make it a DB-level guarantee
-- Run in the Supabase SQL Editor. Fully idempotent — safe to re-run.
--
-- Problem this fixes
-- ------------------
-- Every game needs a random square->category layout (see src/lib/boardLayout.ts).
-- It was only ever set by the client: LobbyScreen writes one at creation, and
-- GameScreen.load() used to *regenerate and write back* a fresh one any time it
-- found the column missing/invalid. That fallback was unsafe:
--   * two clients could hit it at once and write DIFFERENT random layouts
--     (last write wins) after pawns had already moved -> board/positions desync;
--   * regenerating mid-game invalidates every stored pawn position;
--   * a creation path that forgot to set it (e.g. a future matchmaking RPC)
--     would silently depend on that fallback.
--
-- Fix: guarantee a valid layout is produced exactly once, at INSERT, by the
-- database itself — a NOT NULL column with a DEFAULT that generates one
-- server-side. The client never has to synthesize a layout again; GameScreen
-- now only self-heals in the provably-safe pre-game case and otherwise shows a
-- "board corrupted" error instead of guessing.
-- ============================================================================


-- ── 1. Server-side layout generator ────────────────────────────────────────
-- Mirrors generateBoardLayout() in src/lib/boardLayout.ts:
--   hubs:     shuffle of all 6 categories (all distinct — one wedge each)
--   spokes:   [6][2] drawn from a shuffled double-deck of the 6 categories
--   betweens: 4 distinct random categories + 2 'roll_again', shuffled
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


-- ── 2. Backfill any waiting game that is missing a layout ───────────────────
-- Only touch games that have NOT started. An 'active'/'completed' game with a
-- bad layout is real corruption we must not paper over (pawn positions would be
-- meaningless against a new layout) — the client surfaces that as an error.
update public.games
set board_layout = public.generate_board_layout()
where board_layout is null
  and status = 'waiting';


-- ── 3. Column guarantees: DEFAULT + NOT NULL ───────────────────────────────
alter table public.games
  alter column board_layout set default public.generate_board_layout();

do $$
begin
  if exists (select 1 from public.games where board_layout is null) then
    raise warning
      'games.board_layout still has NULL rows (likely active/completed corruption); leaving column nullable. Inspect: select id, status from public.games where board_layout is null;';
  else
    alter table public.games alter column board_layout set not null;
  end if;
end $$;


-- ── 4. Shape check for new / updated rows ──────────────────────────────────
-- NOT VALID: enforced on every INSERT/UPDATE from now on, but existing rows are
-- not scanned — so a legacy corrupt row doesn't block this migration (the
-- client handles it) yet no new bad layout can be written.
alter table public.games drop constraint if exists games_board_layout_shape;
alter table public.games add constraint games_board_layout_shape check (
  board_layout is null or (
    jsonb_typeof(board_layout -> 'hubs')     = 'array' and
    jsonb_typeof(board_layout -> 'spokes')   = 'array' and
    jsonb_typeof(board_layout -> 'betweens') = 'array'
  )
) not valid;


-- ── Verify ─────────────────────────────────────────────────────────────────
--   select public.generate_board_layout();
--   select column_default, is_nullable
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'games' and column_name = 'board_layout';
--   select id, status, board_layout is null as missing from public.games;
