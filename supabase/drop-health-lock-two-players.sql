-- Run in Supabase SQL Editor

-- 1. Drop the unused health column (never read or written anywhere in the app).
alter table public.game_players drop column if exists health;

-- 2. Tighten turn_order to a strict 2-player game. The original check was
--    never explicitly named, so look up its actual name rather than
--    guessing, then drop and re-add it with the tighter bound.
--    (Note: Postgres normalizes "between X and Y" into ">= X AND <= Y" in
--    pg_get_constraintdef, so don't filter on the literal text "between" —
--    just match on the column.)
do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
  where con.conrelid = 'public.game_players'::regclass
    and con.contype = 'c'
    and att.attname = 'turn_order';

  if v_conname is not null then
    execute format('alter table public.game_players drop constraint %I', v_conname);
  end if;
end $$;

alter table public.game_players
  add constraint game_players_turn_order_check check (turn_order between 1 and 2);
