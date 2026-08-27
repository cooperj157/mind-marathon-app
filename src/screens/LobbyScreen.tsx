import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useGames, GameSummary } from '../hooks/useGames';
import { generateBoardLayout } from '../lib/boardLayout';
import { RootStackParamList } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Lobby'>;
};

const TOTAL_CHECKPOINTS = 6;

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function LobbyScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { games, loading, refetch } = useGames(user?.id);
  const [starting, setStarting] = useState(false);

  // Refresh whenever the screen comes back into focus
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  async function handleStartGame() {
    if (!user) return;
    setStarting(true);
    try {
      // Matchmaking is a single atomic server operation (see
      // supabase/2026-08-27-matchmaking.sql). The RPC serializes the whole
      // find-or-create decision, so two players tapping "Start Game" at the
      // same time deterministically land in the SAME game — one as P1, one as
      // P2 — instead of each creating an orphan 'waiting' game.
      const { data, error } = await supabase.rpc('find_or_create_game', {
        p_board_layout: generateBoardLayout(),
      });
      if (error) throw error;

      const match = Array.isArray(data) ? data[0] : data;
      if (!match?.game_id) throw new Error('Matchmaking failed — please try again.');

      navigation.navigate('Game', { gameId: match.game_id as string });
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not start game. Please try again.');
    } finally {
      setStarting(false);
    }
  }

  async function handleCancelGame(gameId: string) {
    const { error } = await supabase.from('games').delete().eq('id', gameId);
    if (error) { Alert.alert('Error', 'Could not cancel game.'); return; }
    refetch();
  }

  function renderGame({ item }: { item: GameSummary }) {
    const initials = getInitials(item.opponentName);
    const isWaiting = item.status === 'waiting';
    return (
      <View style={styles.card}>

        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        <View style={styles.cardInfo}>
          <Text style={styles.opponentName} numberOfLines={1}>{item.opponentName}</Text>

          <View style={styles.turnRow}>
            <View style={[styles.dot, isWaiting ? styles.dotGold : item.isMyTurn ? styles.dotGreen : styles.dotGold]} />
            <Text style={[styles.turnLabel, isWaiting ? styles.turnGold : item.isMyTurn ? styles.turnGreen : styles.turnGold]}>
              {isWaiting ? 'Waiting for opponent' : item.isMyTurn ? 'Your turn' : 'Their turn'}
            </Text>
          </View>

          <View style={styles.pips}>
            {Array.from({ length: TOTAL_CHECKPOINTS }).map((_, i) => (
              <View key={i} style={[styles.pip, i < item.myCheckpoints.length && styles.pipFilled]} />
            ))}
          </View>
        </View>

        {isWaiting ? (
          <TouchableOpacity
            style={styles.resumeBtn}
            onPress={() => handleCancelGame(item.gameId)}
          >
            <Text style={styles.resumeText}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.resumeBtn, !item.isMyTurn && styles.resumeBtnDisabled]}
            onPress={() => navigation.navigate('Game', { gameId: item.gameId })}
          >
            <Text style={[styles.resumeText, !item.isMyTurn && styles.resumeTextDisabled]}>
              Resume
            </Text>
          </TouchableOpacity>
        )}

      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Start Game */}
      <TouchableOpacity style={styles.startBtn} onPress={handleStartGame} disabled={starting}>
        {starting ? (
          <ActivityIndicator color="#F5DEB3" />
        ) : (
          <>
            <View style={styles.startIcon}>
              <Text style={styles.startIconText}>▶</Text>
            </View>
            <Text style={styles.startLabel}>Start Game</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Section header */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionHeading}>ACTIVE GAMES</Text>
        <View style={styles.sectionLine} />
      </View>

      {/* Game list / states */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} color="#2C1810" />
      ) : games.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎲</Text>
          <Text style={styles.emptyTitle}>No games yet</Text>
          <Text style={styles.emptySub}>Tap Start Game to find an opponent</Text>
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={g => g.gameId}
          renderItem={renderGame}
          contentContainerStyle={{ gap: 10, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4E4BC',
    padding: 20,
  },

  // ── Start Game button ──
  startBtn: {
    backgroundColor: '#2C1810',
    borderRadius: 14,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 28,
    shadowColor: '#1a0e08',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  startIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#C8930A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startIconText: {
    color: '#2C1810',
    fontSize: 12,
    marginLeft: 2,
  },
  startLabel: {
    color: '#F5DEB3',
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },

  // ── Section heading ──
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#5C3317',
    letterSpacing: 1,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#C8930A44',
  },

  // ── Game card ──
  card: {
    backgroundColor: '#fff8e8',
    borderWidth: 1.5,
    borderColor: '#C8930A55',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#2C1810',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2C1810',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#F5DEB3',
    fontSize: 15,
    fontWeight: 'bold',
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  opponentName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2C1810',
  },
  turnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotGreen: { backgroundColor: '#2a8a3e' },
  dotGold:  { backgroundColor: '#9C7A50' },
  turnLabel: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  turnGreen: { color: '#2a8a3e' },
  turnGold:  { color: '#9C7A50' },
  pips: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  pip: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#C8930A',
  },
  pipFilled: {
    backgroundColor: '#C8930A',
  },

  // ── Resume button ──
  resumeBtn: {
    backgroundColor: '#C8930A',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  resumeBtnDisabled: {
    backgroundColor: '#E8D4A0',
  },
  resumeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  resumeTextDisabled: {
    color: '#9C7A50',
  },

  // ── Empty state ──
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: 0.6,
  },
  emptyIcon:  { fontSize: 40 },
  emptyTitle: { fontSize: 15, fontWeight: 'bold', color: '#5C3317' },
  emptySub:   { fontSize: 13, color: '#7a5c3a', textAlign: 'center' },
});
