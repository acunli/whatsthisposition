# How what’sthisposition compares

A fair comparison with the tools club players actually use to review games. It was written in **October 2026** from each site's public pages and our own use of their free tiers. These products change often, so check the details on their sites before quoting them. Where another tool is better, we say so.

## The short version

| | what’sthisposition | Chess.com Game Review | Lichess analysis | Chessigma | DecodeChess |
| --- | --- | --- | --- | --- | --- |
| **Price** | Free, unlimited | Free plan is limited; full use needs a paid membership | Free | Free | Subscription |
| **Source code** | Open (GPL-3.0) | Closed | Open (AGPL-3.0) | Not published | Closed |
| **Labels** | Brilliant to Blunder, Book, Miss, Forced; rules documented | Brilliant to Blunder, Book, Miss | Inaccuracy, Mistake, Blunder | Chess.com-style, its own names | Not label-focused |
| **Explanations in words** | Step-by-step, from board facts and engine probes | Short coach comments; more on paid plans | None (engine lines) | One-line comments | Natural-language explanations |
| **"Why it's brilliant"** | Each way of taking it, played out | A one-line comment | n/a | A one-line comment | Not specifically |
| **Watch the lines an explanation names** (hover) | Yes | No | n/a (no written explanations; its engine lines do show a mini-board on hover) | No | Not that we found |
| **Opening statistics** | 1.84M strong-player games, built in | Opening names and book moves | Full opening explorer (masters + all Lichess games) | Opening names | n/a |
| **Engine** | Stockfish 19 lite (WASM), in your browser | Full Stockfish, on their servers | Full Stockfish, server or multi-threaded in-browser | Not documented | Its own analysis |
| **Privacy** | No account; games and photos never leave your browser | Account-based | Account optional | Sign-in optional | Account-based |

## Chess.com Game Review

**What it does well:** it is the reference experience. The labels (Brilliant, Great, Best, … Miss, Blunder) are what most players know; a coach character comments on each move; the deeper analysis runs on Chess.com's servers with full Stockfish; and it is woven into a huge playing site, so a review is one click after a game.

**Where we differ:**
- **Explanations.** For Hikaru's 30.Bxf8!! against demon64fields, the free review said: *"Ignoring the threat on the rook, a difficult move to see!"* That's true, but it doesn't say why the threat can be ignored. Ours shows both ways Black can take, what happens after each, and why saving the rook first is worse ([example in the README](../README.md#why-it-exists)).
- **Transparency.** Chess.com publishes the outline of its model (expected points) but not the details. Our labels follow the same published bands, and every rule we add is in [HOW-IT-WORKS.md](HOW-IT-WORKS.md#33-the-labels).
- **Accuracy.** Chess.com's accuracy formula is unpublished. Ours is fitted to its numbers and lands within about 3.5 points on reviewed games, so you can compare. It is an approximation, not Chess.com's number.
- **Price and limits.** The free plan limits full reviews; ours is free with no limits, because the engine runs on your machine.

**Where Chess.com is stronger:**
- **Engine depth.** Server analysis is deeper and faster than a single-threaded browser engine, especially on long games and very deep tactics.
- **Integration.** Your games are already there, with no username or PGN step.
- **Wider product:** puzzles, lessons and community.

## Lichess

**What it does well:**
- **Free, open source and community-run.**
- **Analysis:** strong server analysis, plus a multi-threaded Stockfish in the browser.
- **The opening explorer:** masters games and every Lichess game, which is far more data than our book.
- **Practice:** "Learn from your mistakes", an excellent study tool and endless practice tools.

**Where we differ:**
- **Labels.** Lichess marks inaccuracies, mistakes and blunders. It doesn't label brilliant, great or missed chances, and it doesn't explain moves in words.
- **Explanations.** We add the *why* (threats, refutations, plans, "why it's brilliant") and hover-to-watch lines.
- **Position X-ray.** Threats, weaknesses, strengths and plans for both sides, drawn on the board.

**Where Lichess is stronger:**
- **Engine strength and speed.** Multi-threaded, and server analysis.
- **Opening data.** The full explorer and tablebases.
- **Studies,** sharing and the community.

We also borrow from Lichess: the win-probability curve and per-move accuracy formula, the colours for drawing arrows, and our opening data, which comes from the Lichess broadcast and Elite databases.

## Chessigma

**What it does well:** a free, Chess.com-style review on the web. You get labels similar to Chess.com's, an accuracy report and short comments, without a membership.

**Where we differ:**
- **Comments.** Chessigma's are one line. For the same 30.Bxf8 it said: *"Clever choice: you leave a piece under threat and stay no worse."* We explain the lines behind the label, and they can be watched on hover.
- **Openness.** Our rules and code are public.

**Where Chessigma may be stronger:** its interface is close to Chess.com's, which some players prefer. We couldn't confirm details such as where its engine runs.

## DecodeChess

**What it does well:** it was built specifically to explain chess in natural language: plans, threats and ideas behind moves, as a paid service.

**Where we differ:**
- **Price and openness:** free and open source.
- **Integration:** a Chess.com-style game review with labels, accuracy and an opening book, built around your own games.
- **Grounding:** our explanations come from rules over board facts and targeted engine searches, so every sentence can be checked against the board.

**Where DecodeChess may be stronger:** it has had years to cover many positional explanations. Ours are best on concrete play: threats, tactics, sacrifices, plans checked by the engine.

## Choosing

- **You want reasons you can follow, for free, privately:** what’sthisposition. It also reads a position from a screenshot on your device.
- **You want the deepest possible engine analysis,** or everything in one playing site: Chess.com (paid) or Lichess (free).
- **You want to dig through opening statistics:** Lichess's opening explorer.

Many players will use more than one. what’sthisposition is happy to be the one you open to *understand* a game.

---

*Corrections welcome: if something here is out of date or wrong, please open an issue.*
