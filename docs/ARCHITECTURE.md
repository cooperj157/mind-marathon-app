# Mind Marathon — Architecture

Mind Marathon is an AI-powered, Trivial-Pursuit-style trivia board game for
mobile. Play is **asynchronous and turn-based** between **2 players**: you roll,
move a pawn around a spoked-wheel board, answer a Claude-generated trivia
question when you land on a category square, and bank a "wedge" when you clear a
category's checkpoint hub. First player to **4 of the 6 wedges** wins.

This document describes how the system is actually built, grounded in the source.
File references use `path:line` so you can jump straight to the code.

---

## 1. System overview

The app is a thin React Native client talking directly to Supabase. There is no
custom application server — game rules run **on the client**, and the only
server-side logic is a handful of Postgres RPCs and one Edge Function. Supabase
provides auth, the Postgres database (with Row Level Security), and a realtime
change feed. Claude Haiku is called only offline-ish, by the question-generation
Edge Function, never from the client.

```
┌──────────────────────────┐
│   React Native + Expo    │
│   (iOS / Android / web)  │
│                          │
│  screens/  hooks/  lib/  │
│  board.ts (rules engine) │
└────────────┬─────────────┘
             │  @supabase/supabase-js (anon key)
             │  · auth (email+password)
             │  · PostgREST reads/writes (RLS-gated)
             │  · rpc(): end_turn / random_question / declare_winner
             │  · realtime: postgres_changes
             ▼
┌──────────────────────────────────────────────┐
│                 Supabase                      │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Auth      │  │ Postgres  │  │ Realtime  │  │
│  │ (users)   │  │ + RLS     │  │ (changes) │  │
│  └───────────┘  └─────┬─────┘  └───────────┘  │
│                       │ SECURITY DEFINER RPCs  │
│                       ▼                        │
│         ┌────────────────────────────┐         │
│         │ Edge Function              │         │
│         │ generate-questions (Deno)  │         │
│         └─────────────┬──────────────┘         │
└───────────────────────┼────────────────────────┘
                        │ HTTPS (x-api-key)
                        ▼
             ┌────────────────────────┐
             │  Anthropic Messages API │
             │  model claude-haiku-4-5 │
             └────────────────────────┘
```

Entry point: `index.ts` registers `App`. `App.tsx` renders a native-stack
navigator whose routes are **auth-gated** by `useAuth()` (`App.tsx:40-49`): a
signed-out user sees only `Login`; a signed-in user sees `Lobby` and `Game`.
A weekly cron (currently disabled) can re-invoke the Edge Function to refresh the
question bank.

---

## 2. Tech stack & versions

From `package.json`:

| Package | Version | Why |
|---|---|---|
| `expo` | ~56.0.5 | Managed RN toolchain / build + OTA; targets iOS, Android, web from one codebase. |
| `react-native` | 0.85.3 | The mobile UI runtime. |
| `react` / `react-dom` | 19.2.3 | React core (dom for the web target via react-native-web). |
| `react-native-web` | ^0.21.2 | Lets the same components render on web (`Platform.OS === 'web'` branches exist). |
| `@react-navigation/native` + `native-stack` | ^7.2.5 / ^7.16.0 | Screen navigation (Login → Lobby → Game). |
| `@supabase/supabase-js` | ^2.106.2 | Single backend SDK: auth, Postgres/PostgREST, RPC, realtime. |
| `expo-secure-store` | ^56.0.4 | Encrypted native storage for the auth session (see §client below). |
| `expo-status-bar` | ~56.0.4 | Status-bar styling. |
| `react-native-svg` | 15.15.4 | Renders the wheel board (`BoardView.tsx`). |
| `react-native-safe-area-context` / `react-native-screens` | ^5.8.0 / ^4.25.2 | Navigation/safe-area primitives. |
| `typescript` | ~6.0.3 (dev) | Types throughout. |

Edge Function runtime is **Deno** (not in package.json): it imports
`std@0.168.0/http/server` and `@supabase/supabase-js@2` from URLs
(`supabase/functions/generate-questions/index.ts:1-2`). Question model id is
`claude-haiku-4-5` (`index.ts:31`).

### Supabase client config (`src/lib/supabase.ts`)

- URL + **anon/publishable** key are hardcoded (`supabase.ts:5-6`). The key is
  prefixed `sb_publishable_…`, i.e. the public client key, so exposure is
  expected; all real protection comes from RLS.
- **Storage adapter is platform-split** (`supabase.ts:8-18`): web uses
  `localStorage`; native uses `expo-secure-store` (encrypted keychain). This is
  the session store for `persistSession: true`.
- `autoRefreshToken: true`, `detectSessionInUrl: false` (`supabase.ts:23-25`).
  URL detection is off because auth is email+password only, not OAuth redirects.

---

## 3. Data model

Defined in `src/lib/schema.sql`. Five tables, all in `public`, all with RLS
enabled.

### `profiles` (`schema.sql:4-8`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users(id)` ON DELETE CASCADE |
| `username` | text | **unique, nullable** — never populated by the app (see §9) |
| `created_at` | timestamptz | default `now()` |

### `games` (`schema.sql:40-47`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `status` | text | default `'waiting'`, CHECK in (`waiting`,`active`,`completed`) |
| `winner_id` | uuid | FK → `profiles(id)` ON DELETE SET NULL |
| `board_layout` | jsonb | the per-game random category assignment (see §5) |
| `created_at` | timestamptz | default `now()` |

### `game_players` (`schema.sql:56-67`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `game_id` | uuid | FK → `games(id)` CASCADE |
| `player_id` | uuid | FK → `profiles(id)` CASCADE |
| `position` | text | default `'center'` — a Position string (§5) |
| `checkpoints_cleared` | text[] | default `{}` — category names banked as wedges |
| `turn_order` | integer | CHECK **between 1 and 2** |
| `is_current_turn` | boolean | default false |
| `joined_at` | timestamptz | default `now()` |
| — | — | UNIQUE `(game_id, player_id)`, UNIQUE `(game_id, turn_order)` |

The two UNIQUE constraints are load-bearing: `(game_id, player_id)` stops
double-joining, and `(game_id, turn_order)` is what makes the matchmaking
join-race safe (§9). A dropped legacy `health` column and the tightened 2-player
`turn_order` CHECK are applied by `supabase/drop-health-lock-two-players.sql`.

### `questions` (`schema.sql:118-127`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `category` | text | CHECK in the 6 categories (`science`,`history`,`geography`,`entertainment`,`sports`,`art_lit`) |
| `body` | text | |
| `correct_answer` | text | |
| `wrong_answers` | text[] | CHECK `array_length = 3` |
| `created_at` | timestamptz | |

### `turns` (`schema.sql:140-149`)
Append-only move log.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `game_id` / `player_id` | uuid | FKs CASCADE |
| `from_position` / `to_position` | text | |
| `question_id` | uuid | FK → `questions(id)` SET NULL; **null for roll-again / no-question moves** |
| `answered_correctly` | boolean | nullable (null when no question was served) |
| `created_at` | timestamptz | |

### RLS policies — what they enforce

- **profiles**: a user may `select`/`update` **only their own** row
  (`auth.uid() = id`, `schema.sql:13-19`). There is **no INSERT policy** — rows
  are created by the trigger below, not the client.
- **games** `select`: visible only to players who have a `game_players` row in
  that game (`schema.sql:77-84`). `delete`: a player may delete their game
  **only while `status = 'waiting'`** and they're a member (`schema.sql:103-111`,
  duplicated in `cancel-waiting-game.sql`) — this backs the Lobby "Cancel"
  button. Note there is **no INSERT or UPDATE policy on games** for clients, yet
  the Lobby inserts games and flips status to `active`; this works only if a
  permissive default/blanket policy exists in the live project that isn't
  captured in this file (**ambiguity — flagged in §9**).
- **game_players** `select`: any member of the game can read all rows for that
  game (`schema.sql:87-94`). `update`: a player may update **only their own row**
  (`player_id = auth.uid()`, `schema.sql:97-99`). No client INSERT policy is in
  this file either (the Lobby inserts player rows).
- **questions** `select`: any authenticated user (`schema.sql:131-133`). This
  means the client can read `correct_answer` and `wrong_answers` directly —
  answer-checking is done client-side (§6, §9).
- **turns**: members can `select` turns in their games; a player can `insert`
  only rows where `player_id = auth.uid()` (`schema.sql:153-164`).

### Auto-profile trigger (`schema.sql:22-33`)

`handle_new_user()` is a `SECURITY DEFINER` trigger fired `AFTER INSERT ON
auth.users`; it inserts a `profiles` row with the new user's id (username left
null). This is why there is no client-side profile INSERT — and why it must be
SECURITY DEFINER, since the new user cannot yet write through RLS.

---

## 4. Server-side logic (RPCs)

`supabase/turn-rpcs.sql`. All three are `SECURITY DEFINER`, i.e. they execute
with the **function owner's** privileges and bypass RLS. This is necessary
because RLS restricts each player to updating **only their own** `game_players`
row, but turn advancement and winner-marking must write rows/tables the caller
cannot touch directly.

- **`end_turn(p_game_id uuid) → void`** (`turn-rpcs.sql:5-31`).
  Reads the current player's `turn_order` and the player count, computes the next
  order as `(v_current_order % v_player_count) + 1`, clears the old
  `is_current_turn`, and sets it on the next player. SECURITY DEFINER is required
  because it writes the **opponent's** row, which RLS's own-row-only update policy
  forbids. The modulo makes it N-player-generic in principle, though the schema
  and matchmaking hardcode 2. **Fragility:** it assumes exactly one row has
  `is_current_turn = true`; if none does, `v_current_order` is null and no update
  happens (turn can stall — §9).

- **`random_question(p_category text) → setof questions`** (`turn-rpcs.sql:34-43`).
  `select * … where category = p_category order by random() limit 1`. A plain SQL
  SECURITY DEFINER function. RLS already allows authenticated reads of questions,
  so SECURITY DEFINER here is mostly for consistency / to keep the query off the
  client; `order by random()` is a full scan but fine at this table size.

- **`declare_winner(p_game_id uuid, p_player_id uuid) → void`**
  (`turn-rpcs.sql:46-56`). Sets `status='completed', winner_id=p_player_id` on the
  game. SECURITY DEFINER because clients have no UPDATE policy on `games`.
  **Trust gap:** it performs **no validation** that `p_player_id` actually earned
  4 wedges, or that the caller is that player — the client is trusted to call it
  honestly (§9).

---

## 5. The board model (`src/lib/board.ts`, `src/lib/boardLayout.ts`)

This is the most subtle part of the system. The board is a Trivial-Pursuit-style
wheel: a center hub, 6 spokes radiating out (2 squares each), and a 12-square
outer ring (`boardLayout.ts:28-42`).

### 5.1 Position encoding (`board.ts:5-30`)

Positions are **strings** so they store directly in `game_players.position`:

- `'center'` — the shared start hub.
- `'spoke:{i}:{j}'` — spoke `i` ∈ 0..5, square `j` ∈ {0 = inner, 1 = mid}.
- `'ring:{k}'` — `k` ∈ 0..11 around the ring, computed mod 12. **Even `k` is a
  hub** (the checkpoint for spoke `k/2`); **odd `k` is a "between" square**.

Helpers: `spokePos(i,j)`, `ringPos(k)` (normalizes k into 0..11),
`hubRingIndex(spoke) = (spoke*2) % 12`, and `parse()` which turns a string back
into a tagged union.

### 5.2 What a square means (`board.ts:35-56`, layout in `boardLayout.ts`)

`squareAt(layout, pos)` resolves a position to a `Square`:
- center → `{kind:'start'}`.
- spoke → a **category** square (never a checkpoint), category from
  `layout.spokes[i][j]`.
- ring, even k → **checkpoint** category square, `layout.hubs[k/2]` (`checkpoint:
  true`).
- ring, odd k → the `layout.betweens[(k-1)/2]` entry, which is either a category
  square or a **`roll_again`** filler.

The per-game layout is randomized by `generateBoardLayout()`
(`boardLayout.ts:53-72`): the 6 **hubs** are a shuffle of all 6 categories so
every checkpoint is a distinct wedge; each spoke gets 2 categories drawn from a
shuffled double-deck; the 6 **betweens** are 4 random categories + 2 `roll_again`,
shuffled. It's generated at game creation in the Lobby
(`LobbyScreen.tsx:79`) and re-generated defensively in `GameScreen.load()` if the
stored layout is missing/invalid (`GameScreen.tsx:63-67`).

### 5.3 Adjacency graph (`board.ts:65-84`)

Undirected `neighbors(pos)`:
- `center` ↔ each `spoke:i:0` (6 edges).
- `spoke:i:0` ↔ `center` (inward) and `spoke:i:1` (outward).
- `spoke:i:1` ↔ `spoke:i:0` (inward) and `ring:(2i)` (outward — the mid square
  connects to its hub).
- `ring:k` ↔ `ring:k-1`, `ring:k+1` (the ring cycle); additionally a **hub**
  (even k) ↔ `spoke:(k/2):1`, letting the ring "dip" back down its spoke.

So hubs are degree-3 junctions (two ring neighbors + one spoke), which is what
creates branching choices.

### 5.4 Legal moves — the no-instant-backtrack walk (`board.ts:92-106`)

`legalDestinations(from, steps)` does a DFS walking **exactly `steps` edges**,
with one rule: you may not immediately reverse the edge you just took
(`if (next === prev) continue`, `board.ts:98`). It collects the set of distinct
**endpoint** squares (not paths), then removes `from` itself
(`board.ts:104-105`). The player then picks among the returned squares.

Notes and subtleties:
- The rule blocks only *immediate* reversal, not revisiting a square two steps
  later, so on larger rolls a path can loop around the ring and even land back
  near the origin via a different route.
- Because only endpoints are recorded, multiple distinct paths to the same square
  collapse to one option.
- Depth is bounded by the die (1..6), so the exponential DFS is cheap.

### 5.5 Worked example

From `center`, roll **3**: the only non-backtracking 3-edge walks are
`center → spoke:i:0 → spoke:i:1 → ring:(2i)` for each spoke `i`. Result: the 6
**hub** squares `{ring:0, ring:2, ring:4, ring:6, ring:8, ring:10}` — i.e. from
the start, a 3 lands you on any checkpoint of your choice.

From a hub, say `ring:0`, roll **2**: neighbors are `ring:11`, `ring:1`, and
`spoke:0:1`. Walking two edges without reversing yields
`{ring:2, ring:10, spoke:0:1's onward neighbor}` → specifically `ring:2`,
`ring:10`, and `spoke:0:0`. Three legal destinations — the branch point that
makes routing a decision rather than a rail.

---

## 6. Client turn state machine (`src/screens/GameScreen.tsx`)

All turn logic lives in the client. The relevant local state is declared at
`GameScreen.tsx:41-54` (`rollResult`, `legalMoves`, `pendingMove`,
`activeQuestion`, `isProcessing`, `winnerName`, …). The sequence:

1. **Roll** — `handleRoll()`. Guards against re-rolling, picks
   `Math.ceil(random*6)` client-side, animates a die for ~8 ticks, then sets
   `rollResult` and computes `legalDestinations(me.position, finalRoll)`. If that
   is empty (a dead end — unreachable on the current d6 board but possible if the
   graph/die/rules change), `autoPassNoMoves()` shows a brief "No moves — turn
   passes" message, logs a non-move `turns` row, calls `end_turn`, and reloads
   (`autoPassingRef` + `isProcessing` prevent double-firing).

2. **Choose a legal square** — `handleSquarePress(pos)`
   (`GameScreen.tsx:183-256`). Rejects taps not in `legalMoves`. Writes the new
   `position` to the player's own row, then branches on `squareAt`:
   - **`roll_again` or `start`** → log a `turns` row (no question), call
     `end_turn`, reload. (See §9: landing on a `roll_again` square actually
     **ends the turn** rather than granting another roll.)
   - **category** → `rpc('random_question')`. If the bank is empty (`!question`),
     it degrades gracefully to the same log-and-end-turn path
     (`GameScreen.tsx:230-251`). Otherwise it stashes `pendingMove` and opens the
     `QuestionModal`.

3. **Answer** — `QuestionModal` shuffles choices, and on tap decides correctness
   by **string-comparing** the choice to `correct_answer`
   (`QuestionModal.tsx:31-35`), then calls back `onAnswer(correct)` after a 1.4 s
   reveal.

4. **Resolve** — `handleAnswer(correct)` (`GameScreen.tsx:259-340`): logs a
   `turns` row with `question_id` + `answered_correctly`. If the answer was
   correct **and** the square was a checkpoint, it appends the category to
   `checkpoints_cleared` (deduped with a Set). If that reaches
   `WIN_WEDGES = 4` (`GameScreen.tsx:16`), it calls `declare_winner` and shows the
   banner. Otherwise it calls `end_turn`. Either way it reloads.

**Error / resync handling** — every write goes through `checkError()`
(`GameScreen.tsx:154-161`), which surfaces a "Sync error" alert on failure. The
recovery philosophy (commented at `GameScreen.tsx:151-153`) is: any failed write
means local state may diverge from the DB, so the only safe move is to
**resync via `load()`** rather than guess. Every failure branch calls `load()`
and clears the in-flight turn state. `isProcessing` serializes the whole
sequence so a second tap can't interleave.

---

## 7. Realtime sync (`GameScreen.tsx:100-114`)

`GameScreen` subscribes to a per-game channel `game:${gameId}` with two
`postgres_changes` listeners: `event: '*'` on `game_players`
(`filter: game_id=eq.…`) and on `games` (`filter: id=eq.…`). **Any** change fires
the same handler — a full `load()` re-fetch. So the model is deliberately simple:
the client never applies deltas; it just treats a change notification as "refetch
everything for this game." This is what makes the async back-and-forth work — when
your opponent ends their turn (their row's `is_current_turn` flips, and yours
flips via the SECURITY DEFINER `end_turn`), your client re-loads and it becomes
your turn. `load()` is also driven on focus and mount (`GameScreen.tsx:96-97`),
and the channel is torn down on unmount (`GameScreen.tsx:113`). The Lobby uses a
lighter approach — `useGames` refetches on focus, not via realtime
(`LobbyScreen.tsx:36`, `useGames.ts:72`).

---

## 8. Question pipeline (`supabase/functions/generate-questions/index.ts`)

A Deno Edge Function that fills the `questions` bank using Claude Haiku.

Flow:
1. POST body `{ category, batch_count = 1, replace = false }` (`index.ts:70`).
2. Validate `category` against the 6 valid categories → 400 if invalid
   (`index.ts:72-77`).
3. Clamp `batch_count` to **1..5** batches (`index.ts:80`); each batch is **20
   questions**, so ≤100 per invocation — capped to stay under the function
   timeout.
4. If `replace`, delete all existing rows for that category first
   (`index.ts:89-92`).
5. For each batch, `generateBatch()` (`index.ts:19-66`) calls the Anthropic
   Messages API (`model claude-haiku-4-5`, `max_tokens: 4000`) with a prompt
   demanding exactly 20 questions, one correct + exactly 3 wrong answers, a
   difficulty mix, nothing after 2023, and **raw JSON only**. The response text is
   trimmed, has stray ```json fences stripped via regex, and is `JSON.parse`d.
6. Insert the rows into `questions`; accumulate `totalInserted`; return a JSON
   summary (`index.ts:112-115`).

**Env / secrets required** (`index.ts:82-86`): `ANTHROPIC_API_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. It uses the **service-role** client,
so its writes bypass RLS.

**Weekly cron refresh** (`supabase/cron.sql`) — **currently disabled** (all
blocks commented out). When enabled it needs the `pg_cron` and `pg_net`
extensions and schedules six `net.http_post` jobs (one per category) every Sunday
03:00 UTC, staggered 5 min apart, each posting `{batch_count: 5, replace: true}`
→ 600 questions total. The service-role key must be pasted into the SQL, not
committed.

---

## 9. Known technical risks / debt

Grounded in the code as read; the ones I'd prioritize:

1. **Client-trusted correctness and win — the big one.** Answer correctness is
   decided in `QuestionModal` by string comparison (`QuestionModal.tsx:29,34`),
   `checkpoints_cleared` is written directly by the client through the own-row
   UPDATE policy (`GameScreen.tsx:288-294`), and `declare_winner` validates
   nothing (`turn-rpcs.sql:46-56`). A modified client can bank any wedges and
   declare itself the winner. Compounding it, RLS lets any authenticated user
   read `questions` including `correct_answer`/`wrong_answers`
   (`schema.sql:131-133`) and `random_question` returns the full row
   (`GameScreen.tsx:221-228`), so the correct answer is on the device before the
   user taps. Making this trustworthy needs server-side answer checking and a
   `declare_winner` that recomputes the win from the `turns` log.

2. **No server validation of moves.** `position` is a raw client write
   (`GameScreen.tsx:191`); the server never checks the move was a legal
   `legalDestinations` result for the roll. A client can teleport its pawn.

3. **`roll_again` doesn't roll again.** `boardLayout.ts:25` and `board.ts:37`
   describe `roll_again` as a "free extra roll," and `BoardView` even draws a ↻
   glyph, but `handleSquarePress` treats `roll_again` exactly like `start`: it
   logs the move and **ends the turn** (`GameScreen.tsx:198-218`). The mechanic
   is effectively a no-op filler square that passes the turn. Either a real
   extra-roll branch is missing, or the docs/label are misleading.

4. **2-player hardcoding.** `turn_order` CHECK 1..2 (`schema.sql:62`,
   `drop-health-lock-two-players.sql:30`), `PLAYER_COLORS` length 2
   (`GameScreen.tsx:17`), matchmaking always joins as `turn_order: 2`
   (`LobbyScreen.tsx:59`). Only `end_turn`'s modulo would survive more players.

5. **Matchmaking races.** `handleStartGame` (`LobbyScreen.tsx:38-101`) reads
   waiting games then inserts — two players starting simultaneously can each fail
   to see the other's freshly-created waiting game and both create their own,
   never matching (they'd each sit waiting). The *join* collision is handled: a
   duplicate `turn_order:2` insert hits the UNIQUE constraint (`23505`) and the
   loop retries (`LobbyScreen.tsx:63-64`). But joining player-2 and flipping
   `games.status` to `active` are **two separate statements**
   (`LobbyScreen.tsx:56-71`) with no transaction — a crash between them leaves a
   full 2-player game stuck in `waiting`.

6. **Turn can stall if `is_current_turn` invariant breaks.** `end_turn` reads the
   single current-turn row; if zero rows are flagged (partial failure elsewhere),
   `v_current_order` is null and nothing advances (`turn-rpcs.sql:15-29`). There's
   no lock around read-modify-write of turn state.

7. **Divergent board-layout fallback.** If `board_layout` is somehow null,
   `GameScreen.load()` generates a fresh one and writes it back
   (`GameScreen.tsx:63-67`). Two clients hitting that path concurrently could
   generate *different* layouts (last write wins), desyncing the board. In
   practice the Lobby sets the layout at creation (`LobbyScreen.tsx:79`), so this
   is a latent edge case rather than a common one.

8. **RLS policies for games/game_players INSERT/UPDATE are not in `schema.sql`.**
   The Lobby inserts `games` and `game_players` rows and updates `games.status`
   (`LobbyScreen.tsx:56-90`), but this file defines no INSERT policy and no
   generic UPDATE policy for those tables. Either the live project has additional
   permissive policies not captured here, or these writes rely on configuration
   outside this repo. **Ambiguous from the code alone — worth confirming against
   the live database.**

9. **Usernames are never set.** The trigger creates `profiles` with `username`
   null (`schema.sql:26`), and no screen ever writes a username. So the UI always
   falls back to "You" / `P1`/`P2` / `Player <last4>`
   (`useGames.ts:54`, `GameScreen.tsx:369`). A profile/username setup flow is
   simply missing.

10. **Client RNG.** Both the die (`GameScreen.tsx:166`) and answer-order shuffle
    rely on `Math.random()` on-device — unverifiable and manipulable, which only
    matters given the trust gaps in (1)–(2).

11. **Edge-function parsing fragility.** The Claude response is `JSON.parse`d
    after a regex fence-strip (`index.ts:61-65`); malformed output throws and
    fails the whole invocation. `wrong_answers` length isn't validated before
    insert, so a bad batch is rejected wholesale by the DB CHECK
    (`schema.sql:125`) rather than per-row.
