# Mind Marathon — Product Requirements Document

**Status:** Working draft · **Last updated:** 2026-08-11 · **Owner:** Cooper
**Platform:** iOS/Android (Expo / React Native) · **Backend:** Supabase (Postgres + Auth + Realtime + Edge Functions)

---

## 1. Overview / Vision

Mind Marathon is an AI-powered, Trivial-Pursuit-style trivia board game for mobile. Two players race
around a spoked-wheel board, rolling a die to move and answering multiple-choice trivia questions across
six categories. The twist on the classic format: the board is a **spoked wheel with category checkpoint
hubs** (not the traditional pie board), and the win condition is shortened — **first to collect 4 of 6
category wedges wins**, for faster games. Questions are drawn from a Claude-generated question bank stored
in the database rather than generated live, so turns are fast and reliable.

The experience goal is a low-friction, pick-up-and-play async duel: matches are **online, turn-based, and
asynchronous** — you take your turn, put the phone down, and get pulled back when it's your move. It should
feel like a snappy trivia race you can play against a friend (or a stranger) over the course of a day.

---

## 2. Target Users

**Confirmed:** the audience is **friends playing casually** — the builder's own social circle, playing
each other for fun. This is not a public/anonymous marketplace product for the foreseeable future.

- **Casual trivia fans** who enjoy games like Trivial Pursuit, QuizUp, or Trivia Crack and want quick
  head-to-head matches without committing to a full sit-down session.
- **Async mobile gamers** comfortable with "play-by-mail" pacing (Words With Friends, Chess.com correspondence)
  who want a board-game feel rather than a raw quiz.
- **Implication:** because players know each other, cheating tolerance is high and anti-cheat can be
  deferred (see §7); but a **solo vs-AI option** matters, so a player always has something to play against
  when no friend is available.

---

## 3. Goals & Non-Goals

### v1 Goals
- Ship a complete, playable **2-player async match** end-to-end: sign in → matchmake → play a full game → win.
- Support **two opponent modes**: **human vs human** (async, the primary mode) and **human vs AI** (a solo
  option so a player always has an opponent).
- Deliver the core loop reliably: roll → move on the spoked wheel → answer a category question → earn wedges
  → win at 4 wedges, with live board sync between the two players.
- Serve trivia from a **pre-generated DB question bank** (Claude Haiku), decoupled from runtime.

### v1 Non-Goals (explicitly out of scope — confirmed decisions)
- **More than 2 players.** 2-player is the permanent v1 target; schema and turn logic stay capped at 2.
- Friends lists, invites, or private matches (matchmaking is anonymous auto-pair).
- Leaderboards, ranking, ELO, or persistent stats beyond the current game.
- **Monetization** (ads, IAP, subscriptions) — non-monetized for the foreseeable future.
- Server-authoritative anti-cheat (answer correctness is currently client-trusted — see §5, §7). Acceptable
  given the friends-only audience; a fast-follow, not a v1 blocker.

---

## 4. Core Gameplay Requirements

**Categories (6):** Science, History, Geography, Entertainment, Sports, Art & Literature (`art_lit`).

**The board — a spoked wheel** (`src/lib/boardLayout.ts`, `src/lib/board.ts`):
- A **center hub** ("start" square) where both pawns begin. Landing here acts as a free roll-again (no question).
- **6 spokes** radiating from the center. Each spoke has **2 regular category squares** (inner + mid).
- A **12-square outer ring**: **6 hub squares** (one per spoke end) plus **6 "between" squares** separating them.
  - The 6 hubs are the **checkpoints** — one distinct category each (all six categories represented).
  - The 6 between-squares are randomly **4 category squares + 2 "roll again" squares**.
- The board layout (which category sits on each square) is **randomly generated per game** and stored on the
  game row, so no two boards are identical.

**Movement** (`legalDestinations` in `board.ts`):
- On your turn you **roll a die (1–6)**.
- Movement walks the board graph exactly N edges. **No immediate backtracking** (you can't reverse the step
  you just took), and **you can't land where you started**.
- Because multiple paths of length N may exist, the game highlights **all legal landing squares** and the
  player **taps one to choose** their destination.
- Adjacency: center ↔ spoke inners; spoke squares chain outward to their hub; the outer ring is a 12-square cycle.

**Squares & questions:**
- Landing on a **category square** (spoke, between, or hub) serves **one random multiple-choice question** of
  that category (1 correct + 3 wrong answers, shuffled).
- Landing on a **roll-again** or the **center/start** square serves **no question** and ends the turn
  (functionally a pass; the turn advances to the opponent).
- If no question exists for a category (empty bank), the square is treated as roll-again and the turn ends.

**Checkpoints & wedges:**
- **Wedges are earned only at hub (checkpoint) squares.** Answering the hub's question correctly awards that
  category's wedge. Correct answers on non-hub category squares do **not** award a wedge.
- Each category wedge can be earned once (deduplicated per player).

**Win condition:**
- The first player to collect **4 of the 6 wedges** wins immediately; the game is marked completed and a
  winner banner is shown to both players.

**Turn structure (one turn):**
1. Active player taps **Roll Dice** (animated die).
2. Legal destination squares highlight; player taps one.
3. Move is saved; the square type is resolved:
   - roll-again/start → log turn, **end turn**;
   - category → fetch & present question in a modal.
4. Player answers; result is logged. If it's a hub and answered correctly, the wedge is recorded (and a win
   is checked). Otherwise the turn ends and passes to the opponent.
5. Board state syncs to both clients via Supabase Realtime.

---

## 5. Feature Requirements

Status reflects the current build (Done / Partial / Planned).

| # | Feature | Requirement | Status | Notes |
|---|---------|-------------|--------|-------|
| 1 | **Auth** | Email + password sign-in / sign-up; session persisted; auto-routes logged-in users to the lobby | **Done** | `LoginScreen.tsx`, `useAuth.ts`, Supabase Auth. Session stored via expo-secure-store. |
| 2 | **Profiles / usernames** | Every user has a profile with a chosen username shown in-game | **Partial** | `profiles` table + auto-create trigger exist, but `username` is never set — no onboarding/edit UI. Players display as **"P1"/"P2"** (or "You"). Schema also lacks an INSERT/self-view path to *set* username from the app. |
| 3 | **Matchmaking / Lobby** | Tap "Start Game" to auto-join a waiting game or create one; list of active games with turn status; cancel a still-waiting game | **Done** | `LobbyScreen.tsx`, `useGames.ts`. Anonymous auto-pair (joins any `waiting` game not your own, else creates one). Handles the race for slot 2 with retry. |
| 4 | **Board & turn loop** | Spoked-wheel board, dice roll, legal-move selection, question modal, checkpoints, win at 4 wedges | **Done** | `GameScreen.tsx`, `BoardView.tsx`, `board.ts`, `boardLayout.ts`. Pawn + dice animation, active-turn highlight, winner banner. SVG board. |
| 5 | **Question generation** | Scheduled batch generates trivia via Claude Haiku and stores it in the bank (not live per turn) | **Partial** | Edge function `generate-questions` works (20/batch, ≤5 batches = 100/category/call, `replace` to wipe first). Weekly `pg_cron` job is **written but commented out/disabled**; must be enabled + service key pasted to actually run. |
| 6 | **Question bank (runtime)** | Serve a random question of the needed category at speed | **Done (unverified seeding)** | `random_question` RPC. Bank must be seeded manually until cron is enabled; if empty, category squares degrade to roll-again. Seeding not verified in this repo. |
| 7 | **Realtime sync** | Both players see moves, turns, and win state update live | **Done** | Supabase Realtime channel on `game_players` + `games`; client re-fetches on any change. Turn advance via `end_turn` RPC. |
| 8 | **Answer validation** | Determine and record whether an answer was correct | **Partial (client-trusted)** | Correctness is computed **on the client** (`QuestionModal` receives `correct_answer`), and the client also writes checkpoints and calls `declare_winner`. Trivially cheatable; not server-authoritative. |
| 9 | **Notifications** | Push notification when it's the player's turn (core to async play) | **Planned** | No push code present. Users must reopen the app to see it's their turn. |
| 10 | **Settings / Sign-out** | Sign out, manage account/settings | **Planned** | No sign-out control and no settings screen anywhere. `useAuth` exposes no `signOut`. |
| 11 | **AI opponent (vs-AI mode)** | Start a solo game against an AI that takes its own turns (rolls, moves, answers) | **Planned** | Confirmed in-scope for v1. Nothing exists yet. Lets a player play when no friend is available. Can start as a simple client-/RPC-driven bot; a stronger version benefits from the server-authoritative turn API (Feature 8). |

---

## 6. Success Criteria — "What does v1 done mean"

Concrete, testable bar for calling v1 complete:

1. **Full match, two devices:** Two real accounts on two devices can matchmake into the same game and play a
   complete match to a 4-wedge win, with each move visible to the opponent within a few seconds.
2. **Identity:** Players choose a username at first sign-in and see each other's usernames (not "P1/P2")
   throughout the lobby and game. *(Currently failing — see Feature 2.)*
3. **Turn notification:** A player who is not in the app receives a push notification when it becomes their
   turn. *(Currently failing — Feature 9.)*
4. **Question bank stays stocked:** Every category has enough questions that category squares reliably serve
   a question (never silently degrade to roll-again), and the bank refreshes on a schedule without manual
   intervention. *(Currently manual — Feature 5/6.)*
5. **Answer integrity:** A correct/incorrect answer is judged by the server, and a player cannot award
   themselves a wedge or a win without genuinely answering correctly. *(Currently failing — Feature 8.)*
6. **Session management:** A user can sign out and back in. *(Currently failing — Feature 10.)*
7. **Rules correctness:** Movement (no backtrack, exact steps, multi-path choice), wedge-only-at-hubs, and
   win-at-4 all behave per §4 across a full playtest.

Items 1 and 7 pass today; 2, 3, 4, 5, 6 are the gap between the current build and a shippable v1.

---

## 7. Open Questions / Assumptions

### Resolved decisions (2026-08-11)
- **Audience:** friends playing casually — not a public/anonymous product. *(See §2.)*
- **Opponent modes:** both **human vs human** and **human vs AI**. Solo vs-AI is in v1 scope. *(Feature 11.)*
- **Player count:** **2 players only**, permanently for v1 — no 3–4 player mode.
- **Monetization:** **none** for the foreseeable future.
- **Cheating tolerance:** high, given the friends-only audience — server-authoritative anti-cheat is a
  fast-follow, not a v1 blocker.

### Still open — decisions for the founder to make
- **Answer authority (security):** Correctness, checkpoints, and win are all client-trusted today. Because the
  audience is trusted friends this isn't a v1 blocker, but note the correct answer ships to the client in
  plaintext. Decide if/when to move judging server-side (an RPC that takes the question + chosen answer and
  returns correctness, and records wedges/wins). *Also unblocks a stronger AI opponent.*
- **Username onboarding:** When and how do users set a username — forced first-run screen, editable in
  settings, or both? Also need the RLS/insert path to let users write their own profile.
- **Notifications:** Which provider (Expo push, FCM/APNs) and what triggers (your-turn, game-over, opponent-joined)?
  This is the linchpin of async play and is currently absent.
- **AI opponent behavior (accuracy decided):** The AI answers with a **fixed ~70% accuracy** for now
  (each question: 70% chance it picks the correct answer, else a random wrong one) — a simple, tunable
  starting point, not per-category skill. Still open: how it's represented in the lobby (a "Play vs AI"
  button vs. matchmaking), and whether to expose difficulty tiers later.
- **Matchmaking model:** Stay with anonymous auto-pair among friends, or add explicit friends/invites/private
  rooms? Async pacing risks abandoned games — is there a move timer or game-expiry policy?
- **Abandoned / stale games:** What happens when an opponent never returns? No timeout, forfeit, or resign
  flow exists today.
- **Question quality / fact-checking:** Claude Haiku output goes straight into the bank. The pre-generation
  model leaves a window to review, but no review/fact-check step exists. Who verifies accuracy, and is a
  human-in-the-loop or an in-app "report question" flow needed?
- **Question freshness & de-duplication:** `replace: true` wipes and regenerates weekly; there's no
  dedup/uniqueness guard, difficulty tagging, or per-player "seen question" tracking to avoid repeats.
- **Categories & difficulty:** Fixed at 6 categories, mixed difficulty per batch. Any plan for themed packs,
  difficulty selection, or a "specials" wedge?
- **Cost / rate control:** Weekly full refresh = ~600 questions/week of Haiku calls. Confirm the budget and
  whether top-up (append) vs. full replace is the right strategy as the bank matures.

---

*Grounded in the current codebase: `App.tsx`, `src/screens/*`, `src/lib/board.ts`, `src/lib/boardLayout.ts`,
`src/lib/schema.sql`, `src/hooks/*`, `supabase/turn-rpcs.sql`, `supabase/cron.sql`, and
`supabase/functions/generate-questions/index.ts`.*
