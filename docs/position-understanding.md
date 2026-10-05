# What a player needs to see in a position

Research notes behind WhatsThisPosition's analysis design. The goal is to turn every
concept an intermediate player uses to *read* a position into something the board can
show and animate, with honest evidence behind it.

## Sources

- Silman's imbalances (How to Reassess Your Chess): superior minor piece, pawn structure,
  space, material, key files, holes/weak squares, development, initiative, king safety,
  statics vs dynamics. "A good plan highlights your positive imbalances."
  ([beginchess](https://beginchess.com/2005/03/16/the-silman-thinking-technique/),
  [patzer's checklist](https://patzersreview.substack.com/p/the-patzers-checklist))
- Wikipedia, [Chess strategy](https://en.wikipedia.org/wiki/Chess_strategy): outposts,
  open/half-open files, seventh rank, overworked pieces, good/bad bishops, knight on the rim,
  open vs closed positions, opposite-coloured bishops, static vs dynamic advantages.
- Chess Programming Wiki: [King safety](https://www.chessprogramming.org/King_Safety)
  (pawn shield, pawn storm, king-zone attack units, safe checks, open files),
  [Space](https://www.chessprogramming.org/Space) (safe squares on the central files behind
  your own pawns), [Pawn structure](https://www.chessprogramming.org/Pawn_Structure)
  (passed, candidate, isolated, doubled, backward, hanging pawns, chains, islands,
  majorities, holes).
- Stockfish's hand-crafted evaluation terms, which the engine used for years to judge positions:
  material, imbalance, pawns, pieces, mobility, king safety, threats, passed pawns, space
  ([overview](https://medium.com/data-science/dissecting-stockfish-part-2-in-depth-look-at-a-chess-engine-2643cdc35c9a)).
- Existing tools: [DecodeChess](https://decodechess.com/features/) (threats with
  before/after toggle, plans tab, piece functionality, explained best line),
  [Chessyi](https://www.chessyi.com/visualization/) (12 overlays: control, mobility,
  attacks, defence, tension, danger zones, king safety, pawn structure, activity, centre),
  [chess-visualizer](https://github.com/tlee753/chess-visualizer) (control heat map),
  [Chess.com Game Review](https://www.chess.com/news/view/game-review-design-update)
  (a coach walking through key moments one at a time).

## What we take from them

1. **A ledger, not a report.** Silman's method is to list what's *different* for each side,
   then plan around your pluses. So every position gets a two-column ledger, White and
   Black, of **strengths** and **weaknesses**, each tied to squares.
2. **One idea at a time.** Game Review's coach and DecodeChess's explained line work because
   they show one thing, then the next. So the app opens with a **guided tour**: the most
   important findings, animated one by one, with a one-line caption.
3. **Overlays you can stack.** Chessyi and the heat-map projects show that control,
   tension and danger zones read instantly as colour. So the explore mode is layers,
   each with a fixed colour meaning.
4. **Before/after.** DecodeChess's threat toggle is the fastest way to understand a
   move. We keep "why this move / why not" and play lines out on the board.

## Concept → how we detect it → how the board shows it

| Concept | Detection (evidence) | On the board |
| --- | --- | --- |
| Hanging / en prise piece | attackers vs defenders, pins respected (rules) | square flashes **red**, pulses; attacker arrow draws in |
| Threat by opponent | null-move search (engine) | the threatened move's arrow + red target box |
| Check / mate in one | legal moves (rules) | king square red; mating move in gold |
| Fork (on board / available) | attacks from one piece on 2+ targets (rules) | star burst from the forking square to each target |
| Pin (absolute / relative) | ray scan (rules) | line from pinner through the pinned piece to what's behind |
| Skewer / x-ray | ray scan with the more valuable piece in front (rules) | line with the front piece ringed |
| Overloaded defender | sole defender of 2+ attacked pieces (rules) | defender ringed red, dashed links to what it guards |
| Trapped piece | attacked and ≤1 safe square (rules) | red box plus the one exit square |
| Back-rank weakness | king on back rank, no free square, enemy heavy piece can reach the rank (rules) | back rank strip flashes red |
| King danger | attackers on the king zone (Stockfish-style attack units), missing shield pawns, open files (rules) | king-zone squares heat up red by intensity; shield pawns get shields; escape squares dotted |
| Piece dominance | squares a piece controls (rules) | squares **flood in the side's colour**, spreading outward from the piece |
| Restricted / bad piece | safe mobility, bishop blocked by own pawns (rules) | red ring, few exit dots |
| Outpost | pawn-supported, never attackable by enemy pawns (rules) | gold square with a flag; knight route as dashed hops |
| Hole / weak square | in own half, no own pawn can ever cover it (rules) | red hatched "pit" |
| Weak colour complex | many holes on one colour + that bishop gone (rules) | squares of that colour dim red |
| Open / half-open file | pawn scan (rules) | file beam; rooks on it glow gold |
| Rook on the 7th | rook on the opponent's second rank (rules) | rank beam gold |
| Connected rooks / battery | aligned sliders with nothing between (rules) | thick animated link between them |
| Passed pawn | no enemy pawn in front on same/adjacent files (rules) | gold **runway** lighting up square by square to promotion |
| Isolated / doubled / backward / hanging pawns | pawn scan (rules) | red rings; doubled pawns linked; backward pawn's stop square marked |
| Pawn chain & base | diagonal pawn links (rules) | chain drawn as links; base marked as the target |
| Pawn majority | pawns per wing (rules) | wing bracket with the count |
| Space | safe squares behind own pawns on the central files (Stockfish's space term) (rules) | territory tint per side with the count |
| Centre control | attackers of d4, d5, e4, e5 (rules) | centre squares split into side colours |
| Development | minor pieces still at home, castling state (rules) | unmoved pieces dimmed |
| Material & imbalances | counts, bishop pair, exchange, opposite bishops (rules) | material strip and highlighted pieces |
| Plans | pawn breaks, piece routes, rook lifts, pushing passers, castling, attacking targets (idea, upgraded to engine when a line plays it) | dashed idea arrows, conditions ticked or open |
| Best moves | Stockfish multi-PV (engine) | line plays out move by move; per-move eval strip |

## Tried and rejected

- **Engine "piece worth"** (static evaluation with each piece removed). Stockfish 19's
  evaluation is normalised to winning chances, so removing a piece produces numbers
  like "queen 5.7, bishop 8.9". That's not a value a player can trust, so the app
  doesn't show it. Piece quality comes from mobility and structure instead.

## Colour meanings (fixed everywhere)

- **Red**: danger, meaning weaknesses, threats and targets.
- **Gold**: strengths and opportunities.
- **Cyan**: White's influence. **Magenta**: Black's influence.
- **Lime, dashed**: an idea the engine hasn't confirmed.
- **Bone/white**: neutral geometry (escape squares, links).

## Evidence labels

Every item is tagged **Board fact** (rules), **Engine** (Stockfish), or **Idea**
(interpretation). Nothing splits the evaluation into invented percentages.

## Game review: how moves are labelled

The game review labels every move the way Chess.com's Game Review does, using rules that work for any game. We studied the open-source projects and published formulas below, then implemented our own version (`src/lib/review/`).

### Sources

- **Chess.com, "How are moves classified?"** (help article). This is the expected-points model: a move is judged by how much of the mover's expected score it loses compared with the best move. The bands are Best 0, Excellent < 0.02, Good < 0.05, Inaccuracy < 0.10, Mistake < 0.20, Blunder ≥ 0.20, plus the special labels Brilliant (a good sacrifice), Great (the only good move, critical), Miss (failing to punish an error), Book and Forced. We use the same bands.
- **Lichess.** The win-percentage curve `50 + 50·(2/(1+e^(−0.00368208·cp)) − 1)`, the move-accuracy formula `103.1668·e^(−0.04354·Δ) − 3.1669`, and game accuracy as the mean of a volatility-weighted mean and a harmonic mean (lichess.org/page/accuracy and lila's `AccuracyPercent`).
- **lichess-org/chess-openings** (CC0). This gives the opening names: 3,863 named lines, which give 7,976 positions counting every position along each line.
- **Lichess broadcast database** (database.lichess.org, CC BY-SA 4.0) and the **Lichess Elite Database** (database.nikonoel.fr, a 2500+ vs 2300+ selection of the CC0 Lichess database). Together they give 1.84M games between strong players, from which `scripts/build-book.mjs` builds the master book: how often each move is played in each position, and how the games ended. Book is "what strong players really play here": at least 0.5% of the games in the position, or 25 games and 0.1%, and not a move the engine calls a mistake. This follows Chess.com's idea of Book as master-database theory. Its exact database and cut-offs aren't published, so ours are our own, measured on real games (`scripts/eval/README.md` §4).
- **WintrChess** (github.com/WintrCat/wintrchess, GPL-3.0). We studied its Brilliant and Great logic:
  - pieces left "unsafe";
  - pieces that were already trapped;
  - "danger levels" (taking the piece lets the taker be hit by something equal or bigger);
  - candidate gating (not when already winning, not when in check, not on a queen promotion).
  We reimplemented the ideas independently and changed the method: exchanges are scored by static exchange evaluation (SEE) with x-rays, and only legal first captures count.
- **freechess** (github.com/WintrCat/freechess). Read for orientation only. Its CC BY-NC-SA licence is incompatible with ours, so none of it is used.

### Accuracy

Lichess's game accuracy (a volatility-weighted mean averaged with a harmonic mean) tracks Chess.com's numbers only loosely. On 46 of Ay7u's games that Chess.com had reviewed, it gave a mean gap of 7.5 points and a correlation of 0.66.

Chess.com doesn't publish its formula, so we fitted one to its output:
- per-move accuracy uses Lichess's formula with a steeper decay (0.07);
- the moves are averaged plainly;
- the average is mapped linearly onto Chess.com's scale: 1.444·x − 43.3.

Fitted on one half of the games and tested on the other, the mean gap is 3.3–4.1 points and the correlation is 0.89. The constants barely move between depth 12 and depth 14. The number shown is labelled as "on Chess.com's scale".

### What we changed or added

| Problem seen in testing | Rule |
| --- | --- |
| Shallow searches misjudge sacrifices and "blunders" (depth 14 calls the Immortal Game's 19.e5 a blunder; depth 18 calls it an inaccuracy) | Two passes: every position next to a Brilliant, Great, Mistake, Miss or Blunder is searched again 4 plies deeper |
| Labels changed from run to run with several engine workers | `ucinewgame` before every search, so results don't depend on hash contents |
| A piece left hanging two moves running was "sacrificed" twice (Kasparov–Topalov 29…Bb7) | Pieces the opponent could already take on their last turn don't count as a new sacrifice |
| Miss isn't defined by WintrChess | Miss: a Mistake or Blunder right after the opponent's Mistake, Blunder or Miss that doesn't leave the mover worse off than before that error (within 2%) |
| One position analysed in "deep" mode got different labels from the same move in a game | Single-position analysis uses the same classifier (`classifyCandidate`) |
| The named lines ended the book after about 5 plies ("1.d4 d5 2.c4 Nf6 3.Nc3" left it) | Book from strong players' games: 7.9 plies on average on Ay7u's 228 games, 74% of games with 6+ plies of theory (was 29%) |
| Popular online traps would count as theory | A master move is Book only if the engine doesn't call it a mistake |

### Explanations

The move card's explanations come from the reasoning engine in `src/lib/reason/` (see the next section). The short per-label templates in `src/lib/review/explain.ts` are only shown for the second or two before it finishes.

### Test set

The same code is run on unrelated games, with no game-specific logic: Morphy's Opera Game, Byrne–Fischer 1956, Anderssen–Kieseritzky 1851, Kasparov–Topalov 1999, the Blackburne Shilling trap, and a 43.g4 test position.

## Move reasoning: what a coach looks for

Owner feedback on 2026-10-05: reasons like "2 more safe squares" are useless; the owner wants reasoning about what each move actually does. So `src/lib/reason/` asks, for any move, the questions a coach asks, in roughly this order of importance:

| Question | How it's answered | Example from real games |
| --- | --- | --- |
| Does it win material or mate? | The material at a settled point of the engine line, in words; never claimed when the engine calls the move a mistake | "wins the queen for a bishop", "picking it up with 6.Bxc4" |
| What does it threaten? | A null move after the move, kept only if new and concrete | "threatens …hxg5, winning a bishop" |
| What was the opponent threatening, and does it stop it? | A null move before the move, re-tested with `searchmoves` | "stops …Nxf3+", "gets the bishop out of the way of hxg4" |
| Which tactic does it use? | Forks, pins, skewers and discovered attacks, only if the moving piece can't simply be taken | not a "fork" for 11…Nc2+?? when Bxc2 takes it |
| Which lines does it take, and at what? | Open and half-open files, the seventh rank, diagonals at the king, batteries, pawn levers on the rook's file | "takes the half-open h-file, aiming at the h3 pawn" |
| What does it prepare? | The engine's next move for this side, made possible by this one | "prepares …Qh6, offering a trade of queens" |
| What does it do for the pieces and pawns? | Outposts, the worst piece activated, restriction and prophylaxis, pressure on a target, breaks, passed pawns, development, castling | "takes b4 away from the knight and the bishop" |
| What does it cost? | Loose pieces, a loosened king cover, lost castling rights, walking into a pin | "loosens the king's pawn cover" |
| For a mistake: how is it punished? | The reply, what it wins (counted from before the move), and lasting damage at the end of the line | "10…Bxf3, leaving White with doubled f-pawns and a king with pawns missing from its shelter" |
| Why not the obvious alternative? | The second-best line and its refutation | "11.Ba4 is weaker: Black answers 11…b5, attacking the bishop" |

Each idea is weighted, and weighted up when the engine's line actually uses it. The headline combines the strongest two. Mobility counts survive only as a last resort.

The rules were iterated by reading every explanation over about 14 real games (`scripts/eval/README.md`). Each fix was made in general terms, never for one position.
