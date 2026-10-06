# Evaluating changes against real games

The owner asked that changes be checked on real games, using the Chess.com account **Ay7u**, and that the comparing and iterating continue. These tools make that repeatable.

Outputs go to `scripts/eval/out/`, which is gitignored: the games are public, but they belong to other people.

## 1. Get the games

```bash
node scripts/eval/fetch-games.mjs Ay7u scripts/eval/out/games.json 3   # last 3 monthly archives
```

Games that Chess.com has reviewed include its accuracy numbers. On 2026-10-05 the account had 228 games, 46 of them reviewed.

## 2. Explanations: read, fix, repeat

```bash
EVAL_GAMES=scripts/eval/out/games.json EVAL_SKIP=0 EVAL_N=4 EVAL_PER=8 \
  npx vitest run src/lib/eval/explain-report.test.ts
less scripts/eval/out/explain-report.txt
```

It covers the games Chess.com reviewed, excluding bullet, in file order. `EVAL_SKIP` picks where to start; on 2026-10-05, games 0–13 of a 3-month fetch had been read.

For every Brilliant, Great, Mistake, Miss and Blunder, and a sample of Best and Excellent moves, the report prints:
- the headline;
- the ideas, with their kind, weight and evidence;
- the threat before the move, and whether the move parried it;
- the opponent's reply;
- the narrated engine line;
- the alternative, and the better move's own headline.

**How to work with it:**
1. Read it as a coach would.
2. Find the rule that produced a wrong or empty sentence (`src/lib/reason/ideas.ts`, `reason.ts`, `line.ts`).
3. Fix the rule in general terms, never for one position (the owner's hard rule).
4. Add a test in `src/lib/reason/reason.test.ts` when the case is clear-cut.
5. Run the report again, ideally with `EVAL_SKIP` set to games you haven't read yet.

To review one particular game, use `EVAL_PGN=game.pgn` (and `EVAL_FOCUS=42,43` for plies to always include). The owner's 21…Rh8 example is ply 42 of https://www.chess.com/game/live/184766330520 (Bisman_Chopra vs hanganggang4, in Bisman_Chopra's 2026/10 archive).

Problems already found and fixed this way are listed in `docs/PROJECT_CONTEXT.md` (progress log, 2026-10-05).

## 3. Accuracy against Chess.com

```bash
EVAL_GAMES=scripts/eval/out/games.json EVAL_DEPTH=14 \
  npx vitest run src/lib/eval/accuracy-data.test.ts      # about 15–30 min for 46 games
python3 scripts/eval/fit-accuracy.py scripts/eval/out/accuracy-data.json
```

This prints the error of what the app shows now, then held-out errors for refits.

**Results on 2026-10-05**, 46 games at depth 14:

| Version | Mean error vs Chess.com | Correlation |
| --- | --- | --- |
| Lichess method | 7.5 | 0.66 |
| Shipped (`ACCURACY_DECAY` 0.07, `1.444·x − 43.3`) | about 3.3–4.1 held-out | 0.89 |

Only change the constants in `src/lib/review/accuracy.ts` if a refit on more games (or another account) is clearly better on held-out games.

## 4. How far games stay in the opening book

```bash
EVAL_GAMES=scripts/eval/out/games.json EVAL_N=228 EVAL_SHOW=40 \
  npx vitest run src/lib/eval/book-coverage.test.ts       # about 1 s per game (classifying is slow)
less scripts/eval/out/book-coverage.txt
```

For each game it prints the book length with the named lines alone and with the master book, the moves in book, the move that left it, and what strong players play there instead. `EVAL_BOOK=other.bin(.gz)` compares another build of `scripts/build-book.mjs`.

**Results on 2026-10-06**, Ay7u's 228 games from a 3-month fetch, measured with the book rule alone (no engine check):

| Book | Mean plies in book | Games with ≥ 6 plies | ≥ 10 plies | Size (gzipped) |
| --- | --- | --- | --- | --- |
| Named lines only (before) | 5.1 | 29% | 7% | (in the JS bundle) |
| 131k over-the-board games, ≥ 10 games per position | 6.1 (first 28 games) | | | 0.45 MB |
| 1.84M games, ≥ 10 games per position, theory ≥ 1% | 7.7 | 68% | 30% | 4.6 MB |
| **Shipped:** 1.84M games, ≥ 20 per position, theory ≥ 0.5% (or 25 games and 0.1%) | **7.9** | **74%** | **30%** | **2.8 MB** |

Most games now leave the book on a move strong players don't really play (9.Bb5+ in the Najdorf move order, 6…Qh5 in the Scandinavian); the rest leave it where the data runs out (fewer than 20 games reached the position), and the opening card says so instead of blaming the move.

**Rebuilding the book:** download the sources listed at the top of `scripts/build-book.mjs` (about 230 MB of broadcasts and 490 MB of Elite Database months), then run it in the **foreground**. Background shells on this machine are throttled to about half a core, which turns 1.5 minutes into 4 or more. `node scripts/build-book.mjs --check file.pgn.zst 3000` compares the fast SAN replayer with chess.js ply by ply (0 differences on 6,000 games, 2026-10-06).

## 5. Brilliant moves: find them, explain them, read, fix

The owner wants brilliant moves explained so that anyone understands *why* (Chess.com's and Chessigma's one-liners are the bar to beat), checked on top players' games.

```bash
# 1. Games from top players (one month each). Hikaru is the owner's example.
for u in hikaru MagnusCarlsen FabianoCaruana GMWSO DanielNaroditsky Firouzja2003 LyonBeast nihalsarin AnishGiri GukeshDommaraju Polish_fighter3000 Ghandeevam2003 rpragchess; do
  node scripts/eval/fetch-games.mjs $u scripts/eval/out/top-$u.json 1; done

# 2. Find every move we label Brilliant (board-only pre-filter, then engine checks at depth 16).
#    Resumable; run shards in parallel, in the FOREGROUND (background shells are throttled).
G=$(ls scripts/eval/out/top-*.json | tr '\n' ',' | sed 's/,$//')
for s in 0 1 2 3 4 5 6 7; do EVAL_GAMES=$G EVAL_SHARD=$s/8 EVAL_BUDGET_S=500 EVAL_OUT=scripts/eval/out/brilliants-$s.jsonl \
  npx vitest run src/lib/eval/brilliant-hunt.test.ts > scripts/eval/out/hunt-$s.log 2>&1 & done; wait

# 3. Explain them all (only the ones still Brilliant under the current rules).
C=$(ls scripts/eval/out/brilliants-*.jsonl | tr '\n' ',' | sed 's/,$//')
EVAL_CORPUS=$C EVAL_N=600 npx vitest run src/lib/eval/brilliant-report.test.ts
less scripts/eval/out/brilliant-report.txt

# One position: EVAL_FEN="<fen before>" EVAL_UCI=h6f8 [EVAL_LINES=1] npx vitest run src/lib/eval/brilliant-report.test.ts
```

**Results on 2026-10-06:**
- 1,107 non-bullet games, about 1.5 hours of hunting in all.
- 213 moves are Brilliant under the current rules, every one explained in 3–6 steps.
- The report runs in about 40 s with the stored analyses.
- By player: Naroditsky 153 (he plays the most), Nihal Sarin 23, Duda 13, Giri 10, Hikaru 7, Vachier-Lagrave 6, Firouzja 5, Gukesh 3, Carlsen 2, So 1, Praggnanandhaa 1.
- Hikaru's 30.Bxf8 against demon64fields is in the corpus.

**What the report found, and what was fixed in general terms:**
- false Brilliants: trades (R×N, N×R, Q×N) and dead-draw liquidations (the classifier now needs a margin and a real net loss);
- grammar in threat and idea clauses;
- repeated threats;
- "takes back" used when the recapture wasn't even;
- pawn gifts;
- promotions;
- defensive sacrifices;
- graded wording when the mover is worse;
- the "why not save it" comparison now uses the verified second-best line.

When reading, ask: would a 1000-rated player understand why the move works, and why the obvious move doesn't?

## Notes

- These tests are skipped unless `EVAL_GAMES` (or `EVAL_PGN`) is set, so `npm test` stays fast.
- The Node engine can only be started once per process, so run the two tests separately.
- The photo reader has its own benchmark: `scripts/vision/README.md`.
