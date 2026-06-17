import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { RootStackParamList } from '../../App';
import BoardView, { PawnInfo } from '../components/BoardView';
import { BoardLayout, generateBoardLayout, CATEGORIES, CATEGORY_COLORS } from '../lib/boardLayout';
import { CENTER } from '../lib/board';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const WIN_WEDGES = 4;
const PLAYER_COLORS = ['#C0392B', '#4A90D9', '#27AE60', '#8E44AD'];

interface PlayerRow {
  player_id:           string;
  position:            string;
  checkpoints_cleared: string[];
  turn_order:          number;
  is_current_turn:     boolean;
  username:            string | null;
}

// The pre-checkpoint layout shape lacked `hubs`/`betweens`.
function isValidLayout(l: any): l is BoardLayout {
  return l && Array.isArray(l.hubs) && Array.isArray(l.spokes) && Array.isArray(l.betweens);
}

function initials(name: string | null, fallback: string): string {
  if (!name) return fallback;
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || fallback;
}

export default function GameScreen({ route }: Props) {
  const { gameId } = route.params;
  const { user } = useAuth();

  const [layout, setLayout]   = useState<BoardLayout | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // 1 — game + board layout
    const { data: game } = await supabase
      .from('games')
      .select('id, board_layout')
      .eq('id', gameId)
      .single();

    let boardLayout = game?.board_layout;
    if (!isValidLayout(boardLayout)) {
      // Heal a game created before checkpoints existed.
      boardLayout = generateBoardLayout();
      await supabase.from('games').update({ board_layout: boardLayout }).eq('id', gameId);
    }
    setLayout(boardLayout);

    // 2 — players
    const { data: rows } = await supabase
      .from('game_players')
      .select('player_id, position, checkpoints_cleared, turn_order, is_current_turn, profiles(username)')
      .eq('game_id', gameId)
      .order('turn_order');

    setPlayers((rows ?? []).map(r => ({
      player_id:           r.player_id,
      position:            r.position ?? CENTER,
      checkpoints_cleared: r.checkpoints_cleared ?? [],
      turn_order:          r.turn_order,
      is_current_turn:     r.is_current_turn,
      username:            ((r.profiles as unknown) as { username: string | null } | null)?.username ?? null,
    })));

    setLoading(false);
  }, [gameId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  if (loading || !layout) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2C1810" />
      </View>
    );
  }

  const me   = players.find(p => p.player_id === user?.id);
  const myTurn = !!me?.is_current_turn;

  const pawns: PawnInfo[] = players.map(p => ({
    position: p.position,
    color:    PLAYER_COLORS[(p.turn_order - 1) % PLAYER_COLORS.length],
    label:    initials(p.username, `P${p.turn_order}`),
  }));

  return (
    <View style={styles.container}>
      {/* Scoreboard — wedges per player */}
      <View style={styles.scoreboard}>
        {players.map(p => (
          <View key={p.player_id} style={styles.scoreCard}>
            <View style={[styles.scoreDot, { backgroundColor: PLAYER_COLORS[(p.turn_order - 1) % PLAYER_COLORS.length] }]} />
            <Text style={styles.scoreName} numberOfLines={1}>
              {p.player_id === user?.id ? 'You' : (p.username ?? `Player ${p.turn_order}`)}
            </Text>
            <Wedges cleared={p.checkpoints_cleared} />
          </View>
        ))}
      </View>

      {/* The board */}
      <View style={styles.boardWrap}>
        <BoardView layout={layout} pawns={pawns} />
      </View>

      {/* Turn banner (roll button arrives in the next step) */}
      <View style={styles.footer}>
        <Text style={[styles.turnText, myTurn ? styles.turnMine : styles.turnTheirs]}>
          {myTurn ? 'Your turn — tap to roll (coming next)' : 'Waiting for opponent…'}
        </Text>
      </View>
    </View>
  );
}

// Six little category dots; filled when that wedge is earned.
function Wedges({ cleared }: { cleared: string[] }) {
  const has = new Set(cleared);
  return (
    <View style={styles.wedges}>
      {CATEGORIES.map(cat => (
        <View
          key={cat}
          style={[
            styles.wedge,
            { borderColor: CATEGORY_COLORS[cat] },
            has.has(cat) && { backgroundColor: CATEGORY_COLORS[cat] },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4E4BC', padding: 16 },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4E4BC' },

  scoreboard: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  scoreCard: {
    flex: 1, backgroundColor: '#fff8e8', borderRadius: 12, padding: 10,
    borderWidth: 1.5, borderColor: '#C8930A55', gap: 6,
  },
  scoreDot:  { width: 10, height: 10, borderRadius: 5 },
  scoreName: { fontSize: 13, fontWeight: 'bold', color: '#2C1810' },
  wedges:    { flexDirection: 'row', gap: 3, flexWrap: 'wrap' },
  wedge:     { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },

  boardWrap: { flex: 1, aspectRatio: 1, alignSelf: 'center', width: '100%', maxWidth: 420 },

  footer:    { paddingTop: 12, alignItems: 'center' },
  turnText:  { fontSize: 15, fontWeight: 'bold' },
  turnMine:  { color: '#2a8a3e' },
  turnTheirs:{ color: '#9C7A50' },
});
