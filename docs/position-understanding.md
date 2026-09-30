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
