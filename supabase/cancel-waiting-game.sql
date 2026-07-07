-- Run in Supabase SQL Editor

create policy "Players can cancel their own waiting game"
  on public.games for delete
  using (
    status = 'waiting'
    and exists (
      select 1 from public.game_players
      where game_id = games.id and player_id = auth.uid()
    )
  );
