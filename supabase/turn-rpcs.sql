-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- Advance the turn to the next player in turn_order.
-- security definer so it can update any player's row despite RLS.
create or replace function public.end_turn(p_game_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_current_order integer;
  v_player_count  integer;
  v_next_order    integer;
begin
  select turn_order into v_current_order
  from public.game_players
  where game_id = p_game_id and is_current_turn = true;

  select count(*) into v_player_count
  from public.game_players
  where game_id = p_game_id;

  v_next_order := (v_current_order % v_player_count) + 1;

  update public.game_players set is_current_turn = false
  where game_id = p_game_id and is_current_turn = true;

  update public.game_players set is_current_turn = true
  where game_id = p_game_id and turn_order = v_next_order;
end;
$$;

-- Fetch one random question for the given category.
create or replace function public.random_question(p_category text)
returns setof public.questions
language sql
security definer
as $$
  select * from public.questions
  where category = p_category
  order by random()
  limit 1;
$$;

-- Mark a game as completed with a winner.
create or replace function public.declare_winner(p_game_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.games
  set status = 'completed', winner_id = p_player_id
  where id = p_game_id;
end;
$$;
