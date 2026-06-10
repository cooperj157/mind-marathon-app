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

export interface BoardLayout {
  // 6 spokes from center, each with 3 category squares
  spokes: Category[][];
  // 12 category squares on outer ring (2 per checkpoint segment)
  ring: Category[];
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
  // 18 spoke squares: 3 of each category, shuffled
  const spokePool = shuffle([...CATEGORIES, ...CATEGORIES, ...CATEGORIES]) as Category[];
  // 12 ring squares: 2 of each category, shuffled
  const ringPool  = shuffle([...CATEGORIES, ...CATEGORIES]) as Category[];

  return {
    spokes: [
      spokePool.slice(0, 3),
      spokePool.slice(3, 6),
      spokePool.slice(6, 9),
      spokePool.slice(9, 12),
      spokePool.slice(12, 15),
      spokePool.slice(15, 18),
    ],
    ring: ringPool,
  };
}
