export const CATEGORIES = [
  'science', 'history', 'geography', 'entertainment', 'sports', 'art_lit',
] as const;

export type Category = typeof CATEGORIES[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  science:       'Science',
  history:       'History',
  geography:     'Geography',
  entertainment: 'Entertainment',
  sports:        'Sports',
  art_lit:       'Art & Lit',
};

export const CATEGORY_COLORS: Record<Category, string> = {
  science:       '#4A90D9',
  history:       '#C0392B',
  geography:     '#27AE60',
  entertainment: '#8E44AD',
  sports:        '#E67E22',
  art_lit:       '#2C1810',
};

// A square is either a trivia category or a free "roll again" space.
export type SquareKind = Category | 'roll_again';

// ─────────────────────────────────────────────────────────────
// BOARD LAYOUT
// A Trivial-Pursuit-style wheel:
//   • center hub (start / roll-again)
//   • 6 spokes radiating out, each with 2 regular squares (inner, mid)
//   • a 12-square outer ring: 6 "hub" squares (one per category — the
//     checkpoints) at the spoke ends, with 1 square between each pair.
// The 6 hub categories are always distinct so every checkpoint is a
// different pie wedge. Win the game by earning 4 of the 6 wedges.
// ─────────────────────────────────────────────────────────────
export interface BoardLayout {
  hubs:     Category[];     // [6]  distinct — checkpoint squares, one per spoke/ring junction
  spokes:   Category[][];   // [6][2]  inner + mid squares between center and each hub
  betweens: SquareKind[];   // [6]  the square sitting between hub i and hub i+1
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateBoardLayout(): BoardLayout {
  // 6 distinct checkpoint categories, one per spoke/ring junction.
  const hubs = shuffle([...CATEGORIES]) as Category[];

  // Each spoke gets 2 regular category squares (inner, mid).
  const spokePool = shuffle([...CATEGORIES, ...CATEGORIES]) as Category[];
  const spokes = Array.from({ length: 6 }, (_, i) => [
    spokePool[i * 2],
    spokePool[i * 2 + 1],
  ]);

  // 6 between-hub ring squares: 4 categories + 2 roll-again, shuffled.
  const betweenPool = shuffle([
    ...shuffle([...CATEGORIES]).slice(0, 4),
    'roll_again',
    'roll_again',
  ]) as SquareKind[];

  return { hubs, spokes, betweens: betweenPool };
}
