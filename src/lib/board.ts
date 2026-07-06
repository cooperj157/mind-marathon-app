import { BoardLayout, Category, SquareKind } from './boardLayout';

// ─────────────────────────────────────────────────────────────
// POSITIONS
// Encoded as strings so they live happily in game_players.position.
//   'center'           — the hub everyone starts on
//   'spoke:{i}:{j}'    — i = spoke 0..5, j = 0 (inner) | 1 (mid)
//   'ring:{k}'         — k = 0..11 around the outer ring.
//                        even k  -> hub (checkpoint) for spoke k/2
//                        odd  k  -> the between square (k-1)/2
// ─────────────────────────────────────────────────────────────
export type Position = string;

export const CENTER: Position = 'center';
export const SPOKE_LEN = 2;     // regular squares per spoke (inner, mid)
export const RING_SIZE = 12;    // 6 hubs + 6 betweens

export const spokePos = (i: number, j: number): Position => `spoke:${i}:${j}`;
export const ringPos  = (k: number): Position => `ring:${((k % RING_SIZE) + RING_SIZE) % RING_SIZE}`;
export const hubRingIndex = (spoke: number): number => (spoke * 2) % RING_SIZE;

export function parse(pos: Position):
  | { type: 'center' }
  | { type: 'spoke'; i: number; j: number }
  | { type: 'ring';  k: number } {
  if (pos === CENTER) return { type: 'center' };
  const [kind, a, b] = pos.split(':');
  if (kind === 'spoke') return { type: 'spoke', i: Number(a), j: Number(b) };
  return { type: 'ring', k: Number(a) };
}

// ─────────────────────────────────────────────────────────────
// SQUARES — what landing on a position means.
// ─────────────────────────────────────────────────────────────
export type Square =
  | { kind: 'start' }                                   // center
  | { kind: 'roll_again' }                              // free extra roll, no question
  | { kind: 'category'; category: Category; checkpoint: boolean };

export function squareAt(layout: BoardLayout, pos: Position): Square {
  const p = parse(pos);
  if (p.type === 'center') return { kind: 'start' };

  if (p.type === 'spoke') {
    return { kind: 'category', category: layout.spokes[p.i][p.j], checkpoint: false };
  }

  // ring
  if (p.k % 2 === 0) {
    // hub == checkpoint
    return { kind: 'category', category: layout.hubs[p.k / 2], checkpoint: true };
  }
  const between: SquareKind = layout.betweens[(p.k - 1) / 2];
  if (between === 'roll_again') return { kind: 'roll_again' };
  return { kind: 'category', category: between, checkpoint: false };
}

// ─────────────────────────────────────────────────────────────
// ADJACENCY (undirected graph)
//   center  <-> spoke:i:0          (6 edges)
//   spoke:i:0 <-> spoke:i:1
//   spoke:i:1 <-> ring:(2i)        (mid connects to its hub)
//   ring:k  <-> ring:(k+1)         (the ring cycle)
// ─────────────────────────────────────────────────────────────
export function neighbors(pos: Position): Position[] {
  const p = parse(pos);

  if (p.type === 'center') {
    return Array.from({ length: 6 }, (_, i) => spokePos(i, 0));
  }

  if (p.type === 'spoke') {
    const out: Position[] = [];
    out.push(p.j === 0 ? CENTER : spokePos(p.i, p.j - 1));       // inward
    out.push(p.j === SPOKE_LEN - 1 ? ringPos(hubRingIndex(p.i))  // outward
                                   : spokePos(p.i, p.j + 1));
    return out;
  }

  // ring
  const out: Position[] = [ringPos(p.k - 1), ringPos(p.k + 1)];
  if (p.k % 2 === 0) out.push(spokePos(p.k / 2, SPOKE_LEN - 1));  // hub dips into its spoke
  return out;
}

// ─────────────────────────────────────────────────────────────
// MOVEMENT
// Walk exactly `steps` edges from `from`, never immediately reversing
// the previous step (no backtracking). Returns the distinct squares a
// pawn could legally land on, so the player picks among them.
// ─────────────────────────────────────────────────────────────
export function legalDestinations(from: Position, steps: number): Position[] {
  const landings = new Set<Position>();

  const walk = (pos: Position, prev: Position | null, left: number) => {
    if (left === 0) { landings.add(pos); return; }
    for (const next of neighbors(pos)) {
      if (next === prev) continue;          // no instant backtrack
      walk(next, pos, left - 1);
    }
  };

  walk(from, null, steps);
  landings.delete(from);                    // can't land where you started
  return [...landings];
}
