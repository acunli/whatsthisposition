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

Problems already found and fixed this way are in the git history (commits from 2026-10-05 on).

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

# One position (writes brilliant-one.txt): EVAL_FEN="<fen before>" EVAL_UCI=h6f8 [EVAL_LINES=1] npx vitest run src/lib/eval/brilliant-report.test.ts
```

**Why is (or isn't) a move Brilliant?** Run the review's two passes on one move of a game and print every gate (top move, runner-up, the best quiet move and the margin, the sacrifice check):

```bash
EVAL_PGN=game.pgn EVAL_PLY=27 [EVAL_DEPTH=18] npx vitest run src/lib/eval/brilliant-diagnose.test.ts
cat scripts/eval/out/brilliant-diagnose.txt      # EVAL_PLY counts half-moves from 1: 14.dxe6 is ply 27
```

**Comparing rules.** Hunt with `EVAL_ALL=1` (keep every sacrifice the classifier weighed, not just Brilliant ones) and `EVAL_VERIFY=1` (do what the review does: search sacrifices again 4 plies deeper, plus the best quiet move when needed), then reclassify offline:

```bash
for s in 0 1 2 3 4 5 6 7; do EVAL_GAMES=scripts/eval/out/ay7u-3m.json EVAL_DEPTH=18 EVAL_VERIFY=1 EVAL_ALL=1 EVAL_SHARD=$s/8 \
  EVAL_BUDGET_S=520 EVAL_OUT=scripts/eval/out/ay7u-sacs-$s.jsonl npx vitest run src/lib/eval/brilliant-hunt.test.ts > /dev/null 2>&1 & done; wait
EVAL_CORPUS=$(ls scripts/eval/out/ay7u-sacs-*.jsonl | tr '\n' ',' | sed 's/,$//') npx vitest run src/lib/eval/brilliant-rules.test.ts
less scripts/eval/out/brilliant-rules.txt         # counts under both rules, every move they disagree on
```

Edit the old rule in `brilliant-rules.test.ts` to compare any variant.

**Results on 2026-10-06:**
- 1,107 non-bullet games, about 1.5 hours of hunting in all.
- 213 moves are Brilliant under the current rules, every one explained in 3–6 steps.
- The report runs in about 40 s with the stored analyses.
- By player: Naroditsky 153 (he plays the most), Nihal Sarin 23, Duda 13, Giri 10, Hikaru 7, Vachier-Lagrave 6, Firouzja 5, Gukesh 3, Carlsen 2, So 1, Praggnanandhaa 1.
- Hikaru's 30.Bxf8 against demon64fields is in the corpus.

**2026-10-10: measuring a sacrifice against playing it safe.** The owner's 14.dxe6 (Ay7u vs jross0120, Chess.com: Brilliant) came out Best: it is the top move and a real sacrifice, but only 0.035 better than 14.Bb5, and Brilliant needed 0.04 over the second-best line. Neither Chess.com's definition nor WintrChess's has such a margin. A sacrifice now has to beat the best move that gives nothing away by `SACRIFICE_MARGIN` (0.01, the engine's noise); when the second-best line is a sacrifice too, that quiet move is searched (`searchQuietMoves`).
- Top-player corpus (425 sacrifices with stored analyses): Brilliant 213 → **276**, none removed. The 63 added were read: real sacrifices (17.Bxb6 axb6 18.Nxb6, 16…Rxf3 17.gxf3, 8.Nd6+ exd6 9.exd6+, 18.Bxh6 …). Still left out: 36 where a quiet move is just as good (pieces handed back into dead-equal endings, e.g. 47…Bxc7 48.Nxc7+).
- 19 of the 63 needed the quiet search: the runner-up was a second way to sacrifice (14…Nge6 against 14…Nce6: margin 0.22 over the best quiet move, 0.006 over the runner-up).
- Ay7u's last 3 months (256 non-bullet games, depth 18 + 22 as the review runs): Brilliant 13 → **17** (14.dxe6, 26.Rd6, 45.Rxc5, 20…Bxb2+); two equal endgame trades stay out.
- The explanations still read well on the new moves (269 explained, none empty). Exchange sacrifices are still worded as "a whole rook on offer".

**2026-10-10, later: club-level gates and pieces that can't be taken because of mate.** The owner's 16…Rxa3 (BLUNDER-MAN9999999 vs Ay7u, both about 1475; Chess.com: Brilliant) came out Best twice over: Black was "already winning" without it (runner-up −9.46, best quiet move −8.2: above 0.93 on Lichess's curve), and taking the rook allows 17…Bxa3#, which the WintrChess-style backfire check counted as "not really offered". Fixes: the "already decided" gates use a curve fitted to the players' rating (§6), judged against the best quiet move for Brilliant; a piece guarded only by mate is a sacrifice. 16…Rxa3: Brilliant at depth 18 and 22.
- Ay7u's 256 games: Brilliant 17 → 20, none removed (23.Rxg4 and 21.Nxg6 by Ay7u, both in games Chess.com reviewed; 31.Nxe6 by an opponent).
- Top players' games, every sacrifice the old mate clause hid: see the 2026-10-10 entry in the notes; the Brilliant ones are mating attacks (29…Ng3+ hxg3 Rh5#, 23.Ng6+) and real offers (21.Nxe6, 37.Bxg6).

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

## 6. Win probability by rating

How sure a win is at a given evaluation depends on who is playing. Collect positions from evenly matched games (engine evaluation, both ratings, result) and fit the slope of the win-chance curve per rating band:

```bash
for s in 0 1 2 3 4 5 6 7; do EVAL_GAMES=scripts/eval/out/ay7u-3m.json EVAL_SHARD=$s/8 \
  EVAL_OUT=scripts/eval/out/winprob-ay7u-$s.jsonl npx vitest run src/lib/eval/winprob-data.test.ts > /dev/null 2>&1 & done; wait
python3 scripts/eval/fit-winprob.py scripts/eval/out/winprob-*.jsonl
```

`EVAL_DEPTH` (12), `EVAL_EVERY` (every 3rd ply from ply 12) and `EVAL_MAXGAP` (150 rating points) set the sampling. For a middle band, fetch a month of games from opponents in the top players' games (`scripts/eval/out/mid/`).

**Results on 2026-10-10** (42,022 positions, evenly matched, |eval| ≤ 15):

| Average rating | Positions | Slope vs Lichess's 0.00368 | 0.93 expected score at |
| --- | --- | --- | --- |
| below 1600 (Ay7u's games) | 3,909 | 0.71× | +9.9 |
| 1600–2000 | 5,599 | 0.57× | +12.4 |
| 2000–2400 | 10,986 | 0.86× | +8.2 |
| 2400–2900 | 5,178 | 0.66× | +10.6 |
| 2900 and up (top players) | 16,350 | 1.01× | +6.9 |

Single 200-point bands are noisy (each is a few accounts, and depth-12 evaluations flatten every slope a little), but the split is clear: below about 2900 the curve is roughly 0.73× as steep (pooled), at the top it is Lichess's. `decisiveSlope` in `src/lib/review/classify.ts` uses 0.73× up to 2600, rising to 1× at 3000, only for the "already decided" gates of Great and Brilliant. Refit with more mid-rated games before changing it, and before using rating-aware curves for the bands or accuracy (which are calibrated on Lichess's curve).

## 7. Miss: a chance let go, or the player's own error?

The owner found that moves Chess.com calls a Miss came out here as Inaccuracies, Mistakes or Blunders. Chess.com's Game Review v2 says a Miss "happens when a player fails to take advantage of a tactical opportunity, find mate, or punish an opponent's bad move", and that a Blunder "must not only drop the position's evaluation significantly but also lose material or allow checkmate". Its per-move labels can't be fetched, so the rule is checked by reading every error in fresh games.

```bash
node scripts/eval/fetch-games.mjs Ay7u scripts/eval/out/ay7u-oct.json 2
# Warm the engine cache and write each shard's labels (rerun until no shard reports new searches).
ALL=$(ls scripts/eval/out/miss-cache-*.jsonl 2>/dev/null | tr '\n' ',' | sed 's/,$//'); mkdir -p scripts/eval/out/miss-new
for s in 0 1 2 3 4 5 6 7; do EVAL_GAMES=scripts/eval/out/ay7u-oct.json EVAL_N=120 EVAL_SHARD=$s/8 EVAL_BUDGET_S=420 EVAL_CACHES=$ALL \
  EVAL_CACHE=scripts/eval/out/miss-cache-$s.jsonl EVAL_OUT=scripts/eval/out/miss-new/report-$s.txt EVAL_LABELS=scripts/eval/out/miss-new/labels-$s.json \
  npx vitest run src/lib/eval/miss-report.test.ts > /dev/null 2>&1 & done; wait
node scripts/eval/miss-diff.mjs scripts/eval/out/miss-base scripts/eval/out/miss-new miss 20   # against an earlier run
```

The report runs the review exactly as the site does (`runReview` at Standard 14 with the second pass at 18, the master book, the players' rating) and prints, for every error, the evaluations, the move before it, and the material the best line and the game's line win or lose (`lineMaterial`). Keep a copy of a run's folder before changing a rule, then compare.

**Results on 2026-10-25**, Ay7u's 119 newest non-bullet games (one more, 185213737676, was left out: see the gotcha below):

| | Miss | Blunder | Mistake | Inaccuracy |
| --- | --- | --- | --- | --- |
| Before (a Mistake or Blunder right after the opponent's error, no worse than before it) | 151 | 357 | 329 | 798 |
| **Now** (`missedChance`) | **208** | **306** | **329** | **790** |

- 116 moves became a Miss: missed tactics (16.Qxd8 instead of 16.Qxg4 winning a piece; 22…b6 instead of 22…Re7 trapping the queen), recaptures not made, missed mates, and won positions let go without losing anything (20.Nd4 from +10.5 to 0.0; 34.g3 from +5.3 to +0.3 in a rook ending). Most had no opponent error the move before, which the old rule required.
- 59 lost the label: moves that lose material themselves (21.Bxe5, −2 along the line; 20…Re8, −3) or that go from level to worse after an opponent's error that only gave equality (the old rule only asked that the mover end no lower than before the error, even when that was lost).
- Not settled by data: where "winning" starts (0.70 on the players' curve, about +3 at club level; 0.75 gives 182 Misses, 0.80 gives 176) and whether Chess.com calls a +3 → +1 slip a Miss. Ask the owner for Chess.com's label on any move that disagrees.

**Gotcha:** one position (`4kb1r/p2rpppp/2Q5/3p3b/4PB2/5P2/PP4PP/3RK1NR w Kk - 1 20`, game 185213737676) makes the lite engine's search explode: depth 10 in 28 ms, 13 in 11 s, 14 not done after 5 minutes. A review of that game in the browser stalls there too.

## Notes

- These tests are skipped unless `EVAL_GAMES` (or `EVAL_PGN`) is set, so `npm test` stays fast.
- The Node engine can only be started once per process, so run the two tests separately.
- The photo reader has its own benchmark: `scripts/vision/README.md`.

## 8. Performance rating

The number under each player's accuracy (`src/lib/review/performance.ts`) is fitted on games Chess.com has reviewed, from players of every level:

```bash
node scripts/eval/fetch-corpus.mjs scripts/eval/out/corpus.jsonl 2400      # ~39,000 reviewed games, about 15 minutes
python3 scripts/eval/fit-performance.py scripts/eval/out/corpus.jsonl scripts/eval/out/top-*.json [--weight=0.35]
```

`fetch-corpus.mjs` samples players from the public country lists and keeps the games that carry Chess.com's accuracies (both ratings, time class, result; every 25th game keeps its PGN). `fit-performance.py` prints, per time class, the expected accuracy at each rating as two straight pieces joined at a knee (`EXPECTED`), how well each weight predicts the result when the performance gap is read as a rating gap, and the spread of performance minus rating by rating band for one weight.

**Results on 2026-11-15**, 36,608 rated games of 20 plies or more:

| Time class | Knee | Expected accuracy at 400 / 800 / 1200 / 1600 / 2000 / 2800 |
| --- | --- | --- |
| Rapid | 650 | 62.6 / 69.8 / 72.9 / 76.1 / 79.2 / 85.5 |
| Blitz | 550 | 65.0 / 70.1 / 72.8 / 75.4 / 78.0 / 83.3 |
| Bullet | 750 | 63.8 / 70.8 / 72.5 / 74.3 / 76.1 / 79.6 |

The result is predicted best at a weight of about 0.50 (log-loss 0.340), nearly as well at 0.40 (0.346) and 0.35 (0.353); ratings alone give 0.624. The shipped weight is 0.35: rapid players around 1200 then land between 224 below and 329 above their rating in the middle half of their games. Chess.com's own performance ratings can't be fetched (logged-in pages only), so the weight can't be fitted to them: a handful of the owner's own numbers would settle it.

Not done yet: checking this site's own accuracy against Chess.com's across rating bands on the corpus's saved PGNs (the accuracy fit in §3 used one account).

**The /chess-accuracy page** reads the same corpus: `python3 scripts/eval/accuracy-by-rating.py scripts/eval/out/corpus.jsonl scripts/eval/out/top-*.json` writes `src/data/accuracy-by-rating.json` (aggregates only: per time class and 200-point rating band, percentiles 5–95 of Chess.com's accuracy and the medians in won and lost games; bands under 150 player-games are dropped). The page's text and questions are built from that file (`src/lib/accuracy/byRating.ts`), so rerun the script after a new `fetch-corpus.mjs` and the page follows. On 2026-11-17: 35,871 games; rapid medians 60.5 (under 400), 72.4 (1000–1199), 77.3 (1600–1799), 82.5 (2200–2399); blitz 2800+ (top players' games) 86.1.

## 9. The position commentary

```bash
EVAL_GAMES=scripts/eval/out/games.json EVAL_SKIP=0 EVAL_N=6 EVAL_PLIES=16,30,46,64,90 EVAL_DEPTH=14 \
  npx vitest run src/lib/eval/commentary-report.test.ts
less scripts/eval/out/commentary-report.txt
```

For a few positions from each game (after the plies given), the report searches the position with three lines, as the analysis page does, and prints the whole commentary (`src/lib/commentary`): the headline and story, the position's types with their meanings, each side's likes and dislikes with their weights, and the plans by type with the engine's note where its lines play them. `EVAL_FENS=file.txt` reports a list of positions instead (one FEN per line, `name | fen` allowed).

Read it as a coach would, find the rule behind a wrong or empty sentence (`kinds.ts` for the types, `structures.ts` for the named pawn structures, `points.ts` for likes and dislikes, `plans.ts`), fix it in general terms, and run it again on games not read yet. `commentary.test.ts` holds the clear-cut cases, including that every sample position reads the same with the colours swapped.

Found and fixed this way on 2026-11-15 (Ay7u's games 40–64 of a 3-month fetch): positions in the middle of an exchange were described by the material on the board ("a piece down" one move before the recapture); a decided position still listed slow plans for the losing side; thin king cover was reported with five defenders against two attackers; rooks behind their own pieces in the middlegame were called idle; and a fianchettoed bishop behind its own knight was called the worst piece.

## 10. Puzzles from a player's games

```bash
EVAL_GAMES=scripts/eval/out/games.json EVAL_PLAYER=Ay7u EVAL_SKIP=0 EVAL_N=8 EVAL_DEPTH=12 \
  npx vitest run src/lib/eval/puzzle-report.test.ts          # about 8 s a game on one engine
less scripts/eval/out/puzzle-report.txt
```

The report reviews the games exactly as `/puzzles` does and prints every Mistake, Miss and Blunder of the player with how it was classified (`allowed:fork`, `missed:mate`, `slip:endgame`…), the puzzle made from it or that none was (no single clear answer), and at the end the weaknesses with their counts, costs and advice, and the training order.

Read it against the games: is the weakness the right one, does the puzzle have one answer, does the sentence say what happens? The rules are in `src/lib/puzzles/build.ts` (what a mistake is) and `profile.ts` (the weaknesses and their words).

Found and fixed this way on 2026-11-16 (Ay7u's games 90–97 of a 3-month fetch): a blunder that lost a bishop two moves later (15.Qa4, 16.Qxa5) was filed as a quiet mistake, because the count of what a line wins stopped at the first quiet stretch; the same move missed three moves running made three puzzles; and a line's summary could stop in the middle of an exchange and say the wrong side won material.


## 11. Review speed

How long a review takes depends on three things: the engines' work (fixed by the depths), the time engines wait for their next job, and searches that run away. Measure them separately, because wall-clock times on a laptop shift with its temperature and whatever else is running:

- **Engine idle time.** In a browser, wrap `Worker` (Playwright `addInitScript`) and add up, per worker, the time from each `bestmove` to the next `go`. On 2026-11-17 this was 206 ms per search before the labelling fix and 27 ms after (11% and 1.5% of engine time); the main thread's long tasks (a `PerformanceObserver` on `longtask`) went from 98 s to 3 s over six reviews.
- **Node counts.** Run the review's searches (MultiPV 2, fresh hash) over many positions with a node count per search (`EngineClient` snapshots carry `nodes`). On 1,115 positions of Ay7u's games: depth 14 median 133k, p99 600k; depth 18 median 750k, p99 2.9M, one search of each far beyond (7.5M and 15M, the same king-trapped ending). `reviewNodes` (`src/lib/review/depths.ts`) must stay well above the normal searches; in 16 full reviews (1,346 searches) none reached it.
- **Scheduling.** Record every search of some reviews (request → lines and nodes), then replay `runReview` with fake searchers that answer after a time proportional to their nodes. That compares queue orders and pool sizes exactly, without engine noise; it is how `EARLY_DEEP_SHARE` and the pool cap were judged (more than 7 engines would save at most a fifth: the longest deeper search becomes the critical path).

Every speed change must leave the review identical: compare the finished review (`sessionStorage["wtp-review"].data`, the packed positions) of the old and new builds on games you haven't used yet.
