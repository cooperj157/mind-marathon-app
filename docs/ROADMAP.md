# Mind Marathon — Roadmap & Status

_AI-powered, Trivial-Pursuit-style async trivia board game. React Native + Expo SDK 56, Supabase (auth/DB/realtime), Claude Haiku question generation. Async turn-based, 2 players, spoked-wheel board, win = first to 4 of 6 wedges._

Last assessed: 2026-08-11, grounded in the code at commit `e00763c`. **Amended 2026-08-27** after the first real end-to-end 2-player play-test (see §6). This is the working backlog — pull tasks from here.

---

## 1. Milestone status

| # | Capability | Status | Evidence |
|---|------------|--------|----------|
| 1 | Foundation (Expo + TS scaffold) | **Done** | `App.tsx`, `package.json` (expo ~56, RN 0.85), `tsconfig.json` |
| 2 | Auth (email/password sign in & sign up) | **Done** | `LoginScreen.tsx`, `useAuth.ts`, `supabase.auth.signInWithPassword`/`signUp` |
| 3 | Schema (profiles/games/game_players/questions/turns) | **Done** | `src/lib/schema.sql` — 5 tables + RLS. **RLS was broken until 2026-08-27** (recursive `game_players` policy → 42P17 on every read); fixed in `supabase/2026-08-27-rls-realtime-fixes.sql`. |
| 4 | Question engine (edge fn + seed + weekly cron) | **Partial** | Edge fn `supabase/functions/generate-questions/index.ts` written; `scripts/seed-questions.sh` is a manual one-shot; `supabase/cron.sql` is **entirely commented out / disabled**. **Bank confirmed seeded — exactly 100 rows/category, all 6 categories (verified 2026-08-27)** — rows dated 2026-07-06, not refreshed since (weekly cron still off). |
| 5 | Lobby + matchmaking + roll + questions + realtime | **Done (as of 2026-08-27)** | `LobbyScreen.tsx` (start/join/cancel), `GameScreen.tsx` (roll/move/answer). Matchmaking + a full game to a win were **verified end-to-end for the first time on 2026-08-27** — previously blocked by the RLS recursion and a Rules-of-Hooks crash in `GameScreen`. |
| 6a | Board render | **Done** | `src/components/BoardView.tsx`, `src/lib/board.ts`, `src/lib/boardLayout.ts` |
| 6b | Dice / movement | **Done** | `handleRoll`/`handleSquarePress` in `GameScreen.tsx`; animated dice + pawn. Movement now forbids revisiting any square in one move (`board.ts` `legalDestinations`). |
| 6c | Questions / wedges / turn / win | **Done (as of 2026-08-27)** | `QuestionModal.tsx`, `Wedges`, `end_turn`/`declare_winner` RPCs. Win + banner verified 2026-08-27. Turn rule changed: a **correct answer keeps the turn and rolls again**; only a wrong answer passes it. |
| 6d | Realtime sync | **Needs a one-time SQL step** | `postgres_changes` subscription exists in `GameScreen.tsx`, but `games`/`game_players`/`turns` were never in the `supabase_realtime` publication, so it never fired. `supabase/2026-08-27-rls-realtime-fixes.sql` adds them; `GameScreen` also has a 4s polling fallback now. |
| — | Polish (pawn/dice anim, drop health col, cancelable waiting games) | **Done** | commit `e00763c`, `supabase/drop-health-lock-two-players.sql`, `supabase/cancel-waiting-game.sql` |
| — | Username / profile onboarding | **Not started** | Profile row auto-created with `username = null` (`schema.sql` L22-29); no screen or write path anywhere (grep: username is only ever _read_) |
| — | Sign-out / settings screen | **Not started** | No `signOut` call in codebase; `useAuth.ts` doesn't even expose one; `App.tsx` has only Login/Lobby/Game |
| — | Push notifications ("your turn") | **Not started** | No `expo-notifications` dependency, no push code anywhere |
| — | Server-side answer/turn validation | **Not started** | Correctness, dice, position, checkpoints, and win are all client-written (see Gap Analysis) |
| — | AI opponent (vs-AI mode) | **Not started** | Confirmed in v1 scope (2026-08-11). No solo/bot code exists. See B10. |

---

## 2. Gap analysis

Each verified against the code.

### G1 — No username / profile onboarding
- **State:** `handle_new_user()` inserts a profile with `id` only; `username` stays `null`. UI falls back to `P1`/`P2` and `Player XXXX` (`useGames.ts` L54). An `update` RLS policy exists but nothing in the app ever writes a username.
- **2026-08-27:** the *read* blocker is cleared — the `profiles` SELECT policy is no longer self-only, so once a username is set both players will see it. What's left for B2 is purely the onboarding UI + the `update` call.
- **Why it matters:** Players are indistinguishable. For an async game where you resume against "Player 3F2A", identity is core to the experience. Blocks a real playtest feeling like a real game.

### G2 — Question bank: seeded but stale, no fact-checking, cron still off
- **State (updated 2026-08-15):** Bank IS seeded — verified live via `random_question` for all 6 categories, rows dated 2026-07-06. `cron.sql` remains disabled, so it hasn't refreshed in ~6 weeks. Exact per-category counts not yet confirmed (could be thin — original seed targeted ~100/category). `GameScreen.tsx` L230 still treats "no question returned" as a free roll-again as a safety net.
- **No validation:** generated questions are inserted with zero fact-checking; `JSON.parse` of the model output is unguarded (`index.ts` L65) and shape isn't validated before insert (only the DB `array_length(wrong_answers,1)=3` check constraint would catch bad rows, hard-failing the whole batch).
- **Also noticed today:** the Supabase project is on the **free tier and auto-pauses after ~1 week of inactivity** — hit this live while verifying. Anyone opening the app after a quiet week will see it fail to load until someone resumes the project from the dashboard. Worth a decision (upgrade tier, or accept manual resume as a friends-only-project quirk).
- **Why it matters:** No longer "no questions = no game" (bank exists), but staleness + the pause behavior are real friction for a project used sporadically by friends.

### G3 — Answer correctness is client-trusted (cheating vector)
- **State:** `QuestionModal` receives `correct_answer` + `wrong_answers` and computes `correct` in the client (`QuestionModal.tsx` L29, L34). `GameScreen.handleAnswer(correct)` trusts that boolean and writes `answered_correctly` + `checkpoints_cleared` directly.
- **Why it matters:** Any user can read the correct answer from the payload or just call the update with `correct = true`. Fine for a friendly 2-player build; a real hardening prerequisite before wider release.

### G4 — Entire game state is client-authoritative
- **State:** Beyond answers: dice is `Math.random` in the client (`GameScreen.tsx` L166); `position` and `checkpoints_cleared` are written by the client via the "update your own row" RLS policy (`schema.sql` L97-99); `declare_winner(game_id, player_id)` (`turn-rpcs.sql` L46) does no check that the caller earned it; turn ownership is enforced only in the UI (`myTurn`), not in RLS.
- **Why it matters:** A player could set their own checkpoints to 4 and call `declare_winner` on themselves, or move anywhere. Same trust tier as G3 — acceptable for trusted friends, must-fix before public.

### G5 — No sign-out / settings
- **State:** No way to log out, change account, or set a username from inside the app. `useAuth` returns `{ session, user, loading }` only.
- **Why it matters:** Can't switch accounts to test 2-player on one device; no basic account hygiene. Small, but blocks testing convenience.

### G6 — Push notifications absent
- **State:** Intended in the stack, entirely unbuilt. No `expo-notifications`, no device-token storage, no send path.
- **Why it matters:** This is an **async** game. Without "it's your turn" nudges, players forget the game exists and matches stall. This is what makes async actually usable.

### G7 — Hardcoded 2-player assumptions
- **State:** `turn_order` CHECK `between 1 and 2` (`schema.sql` L62), `PLAYER_COLORS` has 2 entries (`GameScreen.tsx` L17), `unique(game_id, turn_order)`, lobby hardcodes join as `turn_order: 2` (`LobbyScreen.tsx` L59). `end_turn` itself is already N-player-safe (modulo player count).
- **Why it matters:** Not a bug today, but locks out 3-4 player mode without schema + lobby changes. Decision needed before it's worth touching.

### G8 — Minor / debug leftovers
- **State:** Git history shows `temp: debug` commits were later cleaned (`5e3bda8`). Current tree looks clean. `CLAUDE.md` is an 11-byte stub. No leftover debug UI found. Realtime `load()` re-fetches the full game on every change (fine at this scale, but chatty).

---

## 3. Prioritized backlog

Ordering rationale: unblock a **real playtest** first (identity + a stocked question bank), then make async **usable** (push), then **harden** against cheating, then optional breadth.

### Near-term (unblock a playable friend test)

| ID | Task | Size | Depends on |
|----|------|------|-----------|
| B1 | ~~Seed & verify the question bank.~~ **Verified seeded (2026-08-15):** `random_question` returns a valid row for all 6 categories (science/history/geography/entertainment/sports/art_lit), each shaped correctly (1 correct + 3 wrong answers). Rows are dated 2026-07-06 — seeded once, not refreshed since (cron still disabled, B8). **Remaining sub-task:** confirm exact row counts per category (`select category, count(*) from questions group by category` in the Supabase SQL editor) to check none are thin, and add the `JSON.parse`/shape validity guard to the edge fn before the next reseed. | S | Supabase project must be un-paused (free tier auto-pauses after ~1wk idle — hit this today) |
| B2 | **Username onboarding.** After sign-up (or on first Lobby load when `profile.username is null`), prompt for a username and write it via `supabase.from('profiles').update({username}).eq('id', user.id)` (RLS already allows self-update). Enforce uniqueness (DB already has `unique`), handle the conflict error in UI. Removes all `P1`/`Player XXXX` fallbacks in practice. | S–M | none |
| B3 | **Sign-out + minimal settings.** Add `signOut` to `useAuth` (`supabase.auth.signOut()`); add a header button or small Settings/Profile screen in `App.tsx` (currently absent) exposing sign-out and edit-username. Enables account-switching to test 2-player. | S | B2 (shares the profile-edit UI) |

### Next (make async usable + the AI opponent)

| ID | Task | Size | Depends on |
|----|------|------|-----------|
| B4 | **Push notifications for "your turn".** Add `expo-notifications`, register for a push token on login, store it on `profiles` (new `push_token` column). On `end_turn`, trigger a send to the next player (Supabase DB webhook / edge function → Expo Push API). Requires a real dev build (Expo Go can't get a token on iOS). | L | B2 (profile row to hang token on); dev-build decision (R5) |
| B10 | **AI opponent (vs-AI mode).** Confirmed v1 feature. Add a "Play vs AI" entry point in the lobby that creates a game whose second player is a bot. Bot takes its turn automatically (roll → pick a legal move → answer at a **fixed ~70% accuracy** — 70% chance of the correct answer, else a random wrong one; keep the rate as a single tunable constant). Simplest version drives the bot client-side / via a scheduled RPC without waiting on the full server-authoritative rework (B6); revisit once B6 lands. | M–L | B1 (needs a stocked question bank to answer from) |
| B5 | **Server-side answer validation.** Move correctness server-side: an RPC `answer_question(game_id, question_id, choice)` that looks up `correct_answer` in the DB, records the turn, updates checkpoints, and returns only `{correct}`. Stop sending `correct_answer`/`wrong_answers` to the client for scoring (or accept that they leak and only trust the server verdict). Lower priority given the friends-only audience, but also cleans up the AI's answer path. | M | none (independent of B4) |

### Later (full hardening + breadth — mostly gated on product decisions)

| ID | Task | Size | Depends on |
|----|------|------|-----------|
| B6 | **Make game state server-authoritative.** Server-side dice roll, move legality, checkpoint award, and win detection inside RPCs; tighten RLS so clients can't freely write `position`/`checkpoints_cleared`; guard `declare_winner` so only an earned win from server logic can set it. Enforce turn ownership in RPCs, not just UI. | L | B5 (same pattern, do together) |
| B7 | **AI question fact-checking pass.** Second-model or verification step before questions reach players (e.g. a review prompt, or human spot-check queue). | M | B1 |
| B8 | **Re-enable weekly refresh cron.** Uncomment `supabase/cron.sql`, enable `pg_cron`/`pg_net`, inject service-role key in SQL editor. Only worth it once there are users. | S | B1, B7 |

_~~B9 (3–4 player support)~~ — **cut**: 2-player is the permanent v1 target (R2 resolved). ~~B10~~ moved up to the "Next" tier (vs-AI confirmed in scope)._

---

## 4. Definition of "playable v1"

A 2-player async game a friend could actually play end-to-end:

- **B1** — question bank seeded & verified (without questions there is no game).
- **B2** — usernames, so players see each other as people, not `Player 3F2A`.
- **B3** — sign-out, so a second account can join/test.
- **B4** — push "your turn" nudges, so async matches don't silently die.
- **B10** — vs-AI mode, so a player always has an opponent (confirmed a v1 feature). Can land after B1–B4 as a fast-follow, since it only hard-depends on a seeded question bank (B1).

That's the v1 target. Given the **friends-only audience**, **B5/B6** (server-side answer check and full server-authoritative state) are **deferred** — cheating tolerance is high among friends — though B5 is worth doing eventually since the correct answer ships to the client in plaintext and it also tidies the AI's answer path. Everything else in "Later" (B6–B8) is post-v1.

---

## 5. Risks & open decisions

| ID | Decision needed | Notes |
|----|-----------------|-------|
| R1 | ~~Single-player vs AI?~~ | **Resolved (2026-08-11): YES.** vs-AI is a confirmed v1 feature — see B10. **AI accuracy set to ~70%** (fixed rate, tunable constant); per-category skill / difficulty tiers deferred. |
| R2 | ~~Player count — 2 or 3–4?~~ | **Resolved: 2 only, permanently for v1.** B9 cut. |
| R3 | **Cheating tolerance for v1.** | State is fully client-authoritative (G3/G4). **Audience is friends → tolerance is high**, so B5/B6 are deferred out of v1. Revisit only if the audience ever widens. |
| R4 | **AI question trust.** | No fact-checking; wrong "facts" reach players as truth (G2/B7). Decide acceptable error rate / whether a review step is worth it even for friends. |
| R5 | **Distribution: Expo Go vs dev/EAS build vs App Store.** | Push notifications (B4) require a real build — Expo Go can't obtain an iOS push token. This gates B4. Store submission not needed for a friends-only build (could stay on TestFlight/internal distribution). |
| R6 | **Question refresh cadence & cost.** | Weekly cron is disabled (B8). Re-enabling means recurring Haiku spend and a service-role key living in the SQL editor. Decide cadence and secret handling. |
| R7 | ~~Monetization.~~ | **Resolved: none for the foreseeable future.** |

---

## 6. First end-to-end play-test — 2026-08-27

The core loop was assessed "Done" from the code in August but had **never actually run a 2-player game to completion**. First real play-test (one human, one Claude-driven opponent on Expo web) surfaced five bugs, four fixed in code, one needing a SQL step.

### Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | **RLS infinite recursion (42P17).** `game_players` SELECT policy sub-queried `game_players`; every read of `games`/`game_players`/`turns` 500'd. Lobby + matchmaking were dead. | `is_game_member()` SECURITY DEFINER helper; all cross-table membership checks routed through it. `supabase/2026-08-27-rls-realtime-fixes.sql` + `schema.sql`. |
| 2 | **Rules-of-Hooks crash in `GameScreen`.** `useRef` + an animation `useEffect` sat *after* the `if (loading \|\| !layout) return`, so the hook count changed once data loaded → "Rendered more hooks…" → blank screen on entering any game. | Moved both hooks above the early return. |
| 3 | **Correct answer ended the turn.** `end_turn` fired regardless of correctness; roll-again / START squares also wrongly ended it. | `resetForRoll()` helper: correct answer (and roll-again/START) keeps the turn; only a wrong answer calls `end_turn`. |
| 4 | **Winner banner read "A player wins!"** for the winner. `load()`'s post-win refetch overwrote the "You" name and the opponent's username is `null`. | `load()` checks `winner_id === user.id` → "You", else `username ?? P{turn_order}`. |
| — | **Movement could curl back on itself.** `legalDestinations` only blocked immediate U-turns. | Now tracks a `visited` set — no square is entered twice in one move. (No-op on the current board: shortest cycle is 8, die max is 6. Future-proofs a bigger board.) |
| — | **"No legal moves" was a dead end.** If a roll yielded zero legal destinations, `GameScreen` showed "No moves available…" with no button to pass or re-roll — the turn stuck forever. Unreachable on the current d6 board (shortest cycle 8 > 6, and the `visited`-set change above doesn't alter that), but a latent trap the moment the board graph / die / movement rules change. | `handleRoll` now detects `legalDestinations(...) === []` and calls `autoPassNoMoves()`: after a ~1s visible "No moves — turn passes" message it logs a non-move `turns` row (`from_position == to_position`, `question_id` null) and calls `end_turn`, then `resetForRoll()` + `load()`. Reuses `checkError` / `resetForRoll`. `autoPassingRef` + `isProcessing` guard against double-firing. Composes with the roll-again rule: each roll is an independent check, so a turn kept after a correct answer that then rolls into a dead end still auto-passes. |

### Needs a one-time SQL run (`supabase/2026-08-27-rls-realtime-fixes.sql`)

- **Realtime** — add `games`/`game_players`/`turns` to the `supabase_realtime` publication (they never were, so `postgres_changes` never fired; opponent's board only updated on reload). A 4s polling fallback now covers the gap regardless.
- **Profile visibility** — the `profiles` SELECT policy was self-only, so `GameScreen`'s `profiles(username)` join always returned `null` for the opponent. New `shares_game_with()` helper + policy lets game-mates read each other's username (unblocks B2 actually mattering).

### Follow-up hardening — board_layout (`supabase/2026-08-27-board-layout.sql`)

Play-test observation G4/#7 noted `GameScreen.load()` would regenerate
`board_layout` and write it back whenever it looked missing/invalid — two
clients could race that and write different layouts after pawns had moved, and
regenerating mid-game invalidates every position.

- **DB now guarantees it.** `games.board_layout` is `NOT NULL DEFAULT
  public.generate_board_layout()` with a `games_board_layout_shape` CHECK. The
  SQL generator mirrors `src/lib/boardLayout.ts`. Any creation path that omits
  the column (a future matchmaking RPC, a manual insert) still gets a valid
  distinct layout. Migration is idempotent; it backfills only `waiting` games
  and adds the CHECK `NOT VALID` so legacy rows don't block it.
- **`load()` no longer guesses.** It self-heals only when unambiguously safe —
  `status='waiting'` ∧ caller is player 1 ∧ no `turns` row — which exactly one
  client can satisfy (a waiting game's roster is player 1 alone), so no race.
  Otherwise it `console.error`s and renders a "This game's board is corrupted"
  screen instead of rewriting a live board.
- Needs the one-time SQL run; the client change is safe to ship before it (the
  Lobby still writes a layout explicitly at creation).

### New observations (not yet actioned)

- **Completed games are unreachable.** Once `status = 'completed'`, `useGames` filters the game out and there's no route back to it — neither player can review the result. With no push (B4), a finished game just vanishes from both lobbies; the loser may never see it ended.
- **Roll-again squares are visually indistinguishable** from category squares — same size, gold reads as just another warm colour, the `↻` is ~12px. Players land on them expecting a question. Needs a distinct shape/outline.
- **Client trust confirmed in practice:** the opponent's row (`checkpoints_cleared`, `position`) is freely PATCH-able with the user's own JWT — used deliberately to fast-forward this test, but it's exactly the G3/G4 vector. Still acceptable for the friends-only audience.

---

_Maintenance note: `cron.sql` and the seed script hardcode the project ref `cwmacxbjptrctetwwmgv`; keep in sync if the Supabase project changes._
