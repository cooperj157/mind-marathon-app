import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Animated } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { RootStackParamList } from '../../App';
import BoardView, { PawnInfo } from '../components/BoardView';
import QuestionModal, { QuestionData } from '../components/QuestionModal';
import { BoardLayout, generateBoardLayout, CATEGORIES, CATEGORY_COLORS } from '../lib/boardLayout';
import { Position, CENTER, legalDestinations, squareAt } from '../lib/board';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const WIN_WEDGES    = 4;
const PLAYER_COLORS = ['#C0392B', '#4A90D9'];

interface PlayerRow {
  player_id:           string;
  position:            string;
  checkpoints_cleared: string[];
  turn_order:          number;
  is_current_turn:     boolean;
  username:            string | null;
}

function isValidLayout(l: any): l is BoardLayout {
  return l && Array.isArray(l.hubs) && Array.isArray(l.spokes) && Array.isArray(l.betweens);
}

function initials(name: string | null, fallback: string): string {
  if (!name) return fallback;
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || fallback;
}

export default function GameScreen({ route }: Props) {
  const { gameId } = route.params;
  const { user }   = useAuth();

  const [layout,  setLayout]  = useState<BoardLayout | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);

  // turn state
  const [rollResult,      setRollResult]      = useState<number | null>(null);
  const [rolling,         setRolling]         = useState(false);
  const [displayFace,     setDisplayFace]     = useState<number | null>(null);
  const [legalMoves,      setLegalMoves]      = useState<Position[]>([]);
  const [pendingMove,     setPendingMove]      = useState<{ from: Position; to: Position } | null>(null);
  const [activeQuestion,  setActiveQuestion]   = useState<QuestionData | null>(null);
  const [isProcessing,    setIsProcessing]     = useState(false);
  const [winnerName,      setWinnerName]       = useState<string | null>(null);
  const [gameStatus,      setGameStatus]       = useState<string>('waiting');

  const load = useCallback(async () => {
    const { data: game } = await supabase
      .from('games')
      .select('id, board_layout, status, winner_id')
      .eq('id', gameId)
      .single();

    let boardLayout = game?.board_layout;
    if (!isValidLayout(boardLayout)) {
      boardLayout = generateBoardLayout();
      await supabase.from('games').update({ board_layout: boardLayout }).eq('id', gameId);
    }
    setLayout(boardLayout);

    const { data: rows } = await supabase
      .from('game_players')
      .select('player_id, position, checkpoints_cleared, turn_order, is_current_turn, profiles(username)')
      .eq('game_id', gameId)
      .order('turn_order');

    const mapped: PlayerRow[] = (rows ?? []).map(r => ({
      player_id:           r.player_id,
      position:            r.position ?? CENTER,
      checkpoints_cleared: r.checkpoints_cleared ?? [],
      turn_order:          r.turn_order,
      is_current_turn:     r.is_current_turn,
      username:            ((r.profiles as unknown) as { username: string | null } | null)?.username ?? null,
    }));
    setPlayers(mapped);

    setGameStatus(game?.status ?? 'waiting');

    if (game?.status === 'completed' && game.winner_id) {
      const winner = mapped.find(p => p.player_id === game.winner_id);
      setWinnerName(
        game.winner_id === user?.id
          ? 'You'
          : (winner?.username ?? (winner ? `P${winner.turn_order}` : 'A player')),
      );
    }

    setLoading(false);
  }, [gameId, user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  // Realtime: re-fetch whenever this game's rows change.
  useEffect(() => {
    const channel = supabase
      .channel(`game:${gameId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'game_players',
        filter: `game_id=eq.${gameId}`,
      }, () => load())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'games',
        filter: `id=eq.${gameId}`,
      }, () => load())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[game] realtime channel', status, '- falling back to polling');
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [gameId, load]);

  // Polling fallback: realtime needs the games / game_players tables added to
  // the `supabase_realtime` publication, and the socket can still drop. A
  // turn-based game is cheap to poll, so keep a slow refresh running too.
  useEffect(() => {
    const id = setInterval(() => { load(); }, 4000);
    return () => clearInterval(id);
  }, [load]);

  // Per-player "it's your turn" highlight animation. Must be declared before
  // the loading early-return below, or the hook count changes between renders.
  const activeAnim = useRef<Record<string, Animated.Value>>({}).current;
  const animForPlayer = useCallback((id: string, active: boolean): Animated.Value => {
    if (!activeAnim[id]) activeAnim[id] = new Animated.Value(active ? 1 : 0);
    return activeAnim[id];
  }, [activeAnim]);

  useEffect(() => {
    players.forEach(p => {
      Animated.timing(animForPlayer(p.player_id, p.is_current_turn), {
        toValue: p.is_current_turn ? 1 : 0,
        duration: 250,
        useNativeDriver: false,
      }).start();
    });
  }, [players, animForPlayer]);

  if (loading || !layout) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2C1810" />
      </View>
    );
  }

  const me     = players.find(p => p.player_id === user?.id);
  const myTurn = !!me?.is_current_turn;

  const pawns: PawnInfo[] = players.map(p => ({
    id:       p.player_id,
    position: p.position,
    color:    PLAYER_COLORS[(p.turn_order - 1) % PLAYER_COLORS.length],
    label:    initials(p.username, `P${p.turn_order}`),
  }));

  // ── Error handling ──────────────────────────────────────────
  // Any failed write means local state may no longer match the DB, so the
  // one safe recovery is to resync via load() rather than guess at a fix.
  async function checkError(result: PromiseLike<{ error: any }>, message: string): Promise<boolean> {
    const { error } = await result;
    if (error) {
      console.error(message, error);
      Alert.alert('Sync error', message);
    }
    return !error;
  }

  // Clear the turn-local state so the SAME player can roll again (landing on
  // a roll-again square, or answering a question correctly).
  function resetForRoll() {
    setRollResult(null);
    setDisplayFace(null);
    setLegalMoves([]);
    setPendingMove(null);
  }

  // ── Roll ────────────────────────────────────────────────────
  function handleRoll() {
    if (!me || isProcessing || rollResult !== null || rolling) return;
    const finalRoll = Math.ceil(Math.random() * 6);
    setRolling(true);
    let ticks = 0;
    const interval = setInterval(() => {
      setDisplayFace(1 + Math.floor(Math.random() * 6));
      ticks++;
      if (ticks >= 8) {
        clearInterval(interval);
        setDisplayFace(finalRoll);
        setRollResult(finalRoll);
        setLegalMoves(legalDestinations(me.position, finalRoll));
        setRolling(false);
      }
    }, 70);
  }

  // ── Move chosen ─────────────────────────────────────────────
  async function handleSquarePress(pos: Position) {
    if (!me || !legalMoves.includes(pos) || isProcessing) return;
    setIsProcessing(true);
    setLegalMoves([]);

    const fromPos = me.position;

    const movedOk = await checkError(
      supabase.from('game_players').update({ position: pos }).eq('game_id', gameId).eq('player_id', user!.id),
      'Could not save your move. The board has been refreshed — please try again.',
    );
    if (!movedOk) { await load(); setIsProcessing(false); return; }

    const sq = squareAt(layout!, pos);

    // Category squares serve a question. Roll-again / start squares don't —
    // and a category square with an empty bank falls back to the same path:
    // log the move, then let the SAME player roll again (turn does NOT pass).
    let question: QuestionData | null = null;
    if (sq.kind === 'category') {
      const { data, error: questionErr } = await supabase.rpc('random_question', { p_category: sq.category });
      if (questionErr) {
        Alert.alert('Sync error', 'Could not fetch a question. The board has been refreshed — please try again.');
        await load();
        setIsProcessing(false);
        return;
      }
      question = (data as QuestionData[] | null)?.[0] ?? null;
    }

    if (!question) {
      const turnOk = await checkError(
        supabase.from('turns').insert({
          game_id: gameId, player_id: user!.id,
          from_position: fromPos, to_position: pos,
        }),
        'Could not log your move. The board has been refreshed — please try again.',
      );
      if (!turnOk) { await load(); setIsProcessing(false); return; }

      resetForRoll();
      await load();
      setIsProcessing(false);
      return;
    }

    setPendingMove({ from: fromPos, to: pos });
    setActiveQuestion(question);
    setIsProcessing(false);
  }

  // ── Answer submitted ─────────────────────────────────────────
  async function handleAnswer(correct: boolean) {
    if (!me || !pendingMove || !activeQuestion) return;
    setIsProcessing(true);
    setActiveQuestion(null);

    const sq = squareAt(layout!, pendingMove.to);
    const isCheckpoint = sq.kind === 'category' && sq.checkpoint;

    const turnOk = await checkError(
      supabase.from('turns').insert({
        game_id:            gameId,
        player_id:          user!.id,
        from_position:      pendingMove.from,
        to_position:        pendingMove.to,
        question_id:        activeQuestion.id,
        answered_correctly: correct,
      }),
      'Could not log your answer. The board has been refreshed — please try again.',
    );
    if (!turnOk) {
      await load();
      resetForRoll();
      setIsProcessing(false);
      return;
    }

    let won = false;
    if (correct && isCheckpoint && sq.kind === 'category') {
      const newCheckpoints = [...new Set([...me.checkpoints_cleared, sq.category])];
      const checkpointOk = await checkError(
        supabase
          .from('game_players')
          .update({ checkpoints_cleared: newCheckpoints })
          .eq('game_id', gameId)
          .eq('player_id', user!.id),
        'Could not save your checkpoint. The board has been refreshed — please try again.',
      );
      if (!checkpointOk) {
        await load();
        resetForRoll();
        setIsProcessing(false);
        return;
      }

      if (newCheckpoints.length >= WIN_WEDGES) {
        const winOk = await checkError(
          supabase.rpc('declare_winner', { p_game_id: gameId, p_player_id: user!.id }),
          'Could not record your win. The board has been refreshed — please try again.',
        );
        if (!winOk) {
          await load();
          resetForRoll();
          setIsProcessing(false);
          return;
        }
        setWinnerName(me.username ?? 'You');
        won = true;
      }
    }

    // Correct answer → keep the turn and roll again. Wrong answer → pass it on.
    if (!won && correct) {
      resetForRoll();
    } else if (!won) {
      const endOk = await checkError(
        supabase.rpc('end_turn', { p_game_id: gameId }),
        'Could not end your turn. The board has been refreshed — please try again.',
      );
      if (!endOk) {
        await load();
        resetForRoll();
        setIsProcessing(false);
        return;
      }
      resetForRoll();
    }

    await load();
    setIsProcessing(false);
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {winnerName && (
        <View style={styles.winnerBanner}>
          <Text style={styles.winnerText}>
            {winnerName === 'You' || winnerName === me?.username ? '🏆 You win!' : `${winnerName} wins!`}
          </Text>
        </View>
      )}

      <View style={styles.scoreboard}>
        {players.map(p => {
          const anim = animForPlayer(p.player_id, p.is_current_turn);
          return (
            <Animated.View
              key={p.player_id}
              style={[
                styles.scoreCard,
                {
                  borderColor: anim.interpolate({ inputRange: [0, 1], outputRange: ['#C8930A55', '#2a8a3e'] }),
                  borderWidth: anim.interpolate({ inputRange: [0, 1], outputRange: [1.5, 2] }),
                },
              ]}
            >
              <View style={[styles.scoreDot, { backgroundColor: PLAYER_COLORS[(p.turn_order - 1) % PLAYER_COLORS.length] }]} />
              <Text style={styles.scoreName} numberOfLines={1}>
                {p.player_id === user?.id ? 'You' : (p.username ?? `P${p.turn_order}`)}
              </Text>
              <Wedges cleared={p.checkpoints_cleared} />
            </Animated.View>
          );
        })}
      </View>

      <View style={styles.boardWrap}>
        <BoardView
          layout={layout}
          pawns={pawns}
          legalMoves={myTurn ? legalMoves : []}
          onSquarePress={myTurn ? handleSquarePress : undefined}
        />
      </View>

      <View style={styles.footer}>
        {winnerName ? null : gameStatus === 'waiting' ? (
          <Text style={styles.waitingText}>Waiting for opponent to join…</Text>
        ) : myTurn ? (
          rollResult === null && !rolling ? (
            <TouchableOpacity
              style={[styles.rollBtn, isProcessing && styles.rollBtnDisabled]}
              onPress={handleRoll}
              disabled={isProcessing}
            >
              <Text style={styles.rollBtnText}>Roll Dice</Text>
            </TouchableOpacity>
          ) : rolling ? (
            <View style={styles.rollResult}>
              <Text style={styles.rollResultDie}>🎲 {displayFace}</Text>
              <Text style={styles.rollResultHint}>Rolling…</Text>
            </View>
          ) : (
            <View style={styles.rollResult}>
              <Text style={styles.rollResultDie}>🎲 {rollResult}</Text>
              <Text style={styles.rollResultHint}>
                {legalMoves.length > 0 ? 'Tap a highlighted square to move' : 'No moves available…'}
              </Text>
            </View>
          )
        ) : (
          <Text style={styles.waitingText}>Waiting for opponent…</Text>
        )}
      </View>

      {activeQuestion && (
        <QuestionModal question={activeQuestion} onAnswer={handleAnswer} />
      )}
    </View>
  );
}

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

  winnerBanner: {
    backgroundColor: '#C8930A', borderRadius: 12, padding: 12, marginBottom: 10, alignItems: 'center',
  },
  winnerText: { fontSize: 20, fontWeight: 'bold', color: '#fff' },

  scoreboard: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  scoreCard: {
    flex: 1, backgroundColor: '#fff8e8', borderRadius: 12, padding: 10,
    borderWidth: 1.5, borderColor: '#C8930A55', gap: 6,
  },
  scoreCardActive: { borderColor: '#2a8a3e', borderWidth: 2 },
  scoreDot:   { width: 10, height: 10, borderRadius: 5 },
  scoreName:  { fontSize: 13, fontWeight: 'bold', color: '#2C1810' },
  wedges:     { flexDirection: 'row', gap: 3, flexWrap: 'wrap' },
  wedge:      { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },

  boardWrap: { flex: 1, aspectRatio: 1, alignSelf: 'center', width: '100%', maxWidth: 420 },

  footer:       { paddingTop: 12, alignItems: 'center' },
  rollBtn:      { backgroundColor: '#2C1810', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 48 },
  rollBtnDisabled: { opacity: 0.5 },
  rollBtnText:  { color: '#F4E4BC', fontSize: 18, fontWeight: 'bold' },
  rollResult:   { alignItems: 'center', gap: 6 },
  rollResultDie:  { fontSize: 32 },
  rollResultHint: { fontSize: 14, color: '#5C3317' },
  waitingText:  { fontSize: 15, fontWeight: 'bold', color: '#9C7A50' },
});
