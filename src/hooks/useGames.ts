import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface GameSummary {
  gameId:               string;
  isMyTurn:             boolean;
  myCheckpoints:        string[];
  opponentId:           string | null;
  opponentName:         string;
  opponentCheckpoints:  string[];
}

export function useGames(userId: string | undefined) {
  const [games, setGames]     = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGames = useCallback(async () => {
    if (!userId) { setGames([]); setLoading(false); return; }
    setLoading(true);

    // 1 — My game_player rows
    const { data: myRows } = await supabase
      .from('game_players')
      .select('game_id, is_current_turn, checkpoints_cleared')
      .eq('player_id', userId);

    if (!myRows?.length) { setGames([]); setLoading(false); return; }

    // 2 — Keep only active games
    const { data: activeGames } = await supabase
      .from('games')
      .select('id')
      .in('id', myRows.map(r => r.game_id))
      .eq('status', 'active');

    const activeIds = new Set(activeGames?.map(g => g.id) ?? []);
    const activeRows = myRows.filter(r => activeIds.has(r.game_id));

    if (!activeRows.length) { setGames([]); setLoading(false); return; }

    // 3 — Opponent rows (everyone in those games except me)
    const { data: opponentRows } = await supabase
      .from('game_players')
      .select('game_id, player_id, checkpoints_cleared, profiles(username)')
      .in('game_id', activeRows.map(r => r.game_id))
      .neq('player_id', userId);

    // 4 — Build summaries, your-turn games first
    const summaries: GameSummary[] = activeRows
      .map(row => {
        const opp     = opponentRows?.find(o => o.game_id === row.game_id);
        const profile = opp?.profiles as { username: string | null } | null;
        const oppName = profile?.username ?? (opp ? `Player ${opp.player_id.slice(-4).toUpperCase()}` : 'Waiting...');

        return {
          gameId:              row.game_id,
          isMyTurn:            row.is_current_turn,
          myCheckpoints:       row.checkpoints_cleared ?? [],
          opponentId:          opp?.player_id ?? null,
          opponentName:        oppName,
          opponentCheckpoints: opp?.checkpoints_cleared ?? [],
        };
      })
      .sort((a, b) => Number(b.isMyTurn) - Number(a.isMyTurn));

    setGames(summaries);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  return { games, loading, refetch: fetchGames };
}
