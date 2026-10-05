# WhatsThisPosition

> Working on this repo? Start with [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md).

An X-ray for chess games and positions, built for **whatsthisposition.com**.

**Game review.** Bring a game from Chess.com (username), Lichess (game link) or a PGN. Stockfish reviews every move in your browser, and each move gets a Chess.com-style label: **Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder** or **Forced**. Each label comes with an explanation drawn from the engine's lines. The review also shows accuracy for both players, an eval graph, key moments and a per-player label table. From any move you can play out the better line, or **deep-analyse that position**. The labels follow the same rules for every game; see [How moves are labelled](docs/position-understanding.md#game-review-how-moves-are-labelled).

**Position analysis.** Drop a screenshot (read on your device, no upload), paste a FEN or set up a board. After a 3D scan intro, the position's **threats, weaknesses, strengths and plans for both sides** light up on the squares, with Stockfish checking the concrete claims.

**What you get after analysing a position**

- **Scoreboard:** the verdict in words, the eval (mate shown separately), a vertical eval bar beside the board, and each side's strength and weakness counts.
- **Story:** a guided tour of the most important findings, animated one by one on the board. It ends with the engine's move.
- **Strengths & weaknesses:** a Silman-style ledger for both sides, plus "what each side should try". Every item points at its squares.
- **Moves:** Stockfish's candidate lines played out move by move, with a per-move eval strip, "Why this move?", "Why not?", Compare, and "Try it first". You can also play your own move and ask about it.
- **Layers:** stackable overlays for threats, king safety, pawn structure, pieces, space & control, and material.
- **Plans:** conditional ideas (pawn breaks, knight routes, rook lifts, pushing passers, castling), each with what it depends on.

How each concept is detected and drawn, with sources, is in [`docs/position-understanding.md`](docs/position-understanding.md).

## Quick start

```bash
npm install          # also copies the Stockfish WASM build into public/engine
cp .env.example .env.local   # optional: the cloud photo reader and Lichess username import
npm run dev          # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

Requires Node.js 20.9 or newer.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (copies the engine first) |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Vitest suite, including a real Stockfish integration test |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run vision:check` | Checks the SoCLaaS key, lists models, tests image input |
| `npm run typecheck` | `tsc --noEmit` |

## Environment variables

Screenshots are read on the device and need no configuration. The keys below only enable the optional cloud reader for angled photos of real boards, and Lichess username import. Copy `.env.example` to `.env.local` and fill it in:

| Variable | Purpose |
| --- | --- |
| `VISION_PROVIDER` | `soclaas` (default when `SOCLAAS_API_KEY` is set) or `anthropic` |
| `SOCLAAS_BASE_URL` | NUS SoCLaaS OpenAI-compatible gateway, `https://soclaas-api.comp.nus.edu.sg/v1` |
| `SOCLAAS_API_KEY` | Your SoCLaaS key. Server-side only. |
| `SOCLAAS_MODEL` | Model id. It **must accept images**. Check with `npm run vision:check` (lists models and runs a tiny image test). |
| `ANTHROPIC_API_KEY`, `VISION_MODEL` | Optional alternative provider |
| `LICHESS_TOKEN` | Optional. Lets "Lichess username" list a player's games: Lichess only lists games to signed-in apps. A free personal token with no scopes is enough. Game links work without it. |

The OpenAI-compatible provider asks for a compact answer: 8 rows of 8 characters plus the unsure squares. It strips `<think>` blocks, validates the answer with zod, and retries once if it's malformed.

## How it's organised

```
src/lib/chess/      board geometry, attack maps, FEN parsing + validation
src/lib/engine/     UCI parsing, score normalization, EngineClient (Web Worker transport)
src/lib/review/     game review: PGN parsing, opening book, piece safety (SEE), move labels,
                    accuracy, two-pass review, explanations, Chess.com/Lichess import
src/lib/facts/      visual facts per lens (threats, king, pawns, structure, space, tactics,
                    pieces, control, material), ledger, advice, tour, tracing,
                    move explanations, plans
src/lib/vision/     on-device board reader (local/), recognition schema, cloud provider adapter
src/lib/reason/     move reasoning: board ideas, engine probes, refutations, line stories
src/lib/plans/      plan cards (benefits, drawbacks, meter) and engine timing
src/lib/variation.ts  engine lines → verified moves, navigation
src/components/     BoardStage (animated board), home, game review, setup flow,
                    analysis arena, scan intro
src/app/api/recognize  POST photo → recognized grid (nothing is stored)
src/app/api/games      GET recent Chess.com games / a Lichess game (nothing is stored)
scripts/build-openings.mjs  rebuilds src/data/openings.json from lichess-org/chess-openings
```

### Engine

- **Stockfish 19** via [Stockfish.js](https://github.com/nmrugg/stockfish.js), the *lite single-threaded* WASM build (~1.8 MB, no cross-origin isolation needed). It runs in a Web Worker, so the interface never blocks.
- The binary comes from the pinned `stockfish` npm package and is copied to `public/engine/` by `scripts/copy-engine.mjs`. The copy runs on install, dev and build. Nothing is fetched from third-party hosts at runtime.
- Users can pick depth (12–24) or time (5 s / 15 s) and the number of lines (1–5). A progress bar shows the search, and **Stop** keeps the partial result.
- **Score perspective:** UCI reports scores from the side to move's view. `normalizeScore` converts every score to White's view once, and mates are kept as their own type (`{kind: "mate", moves, winner}`). `src/lib/engine/stockfish.test.ts` runs the real engine in Node to pin this down.

### Where explanations come from

Every claim on screen is tagged with its source:

- **Board fact**: follows from the placement and legal moves (chess.js plus our own attack maps). Examples: hanging pieces (pins respected), forks, pins, overloaded defenders, escape squares, pawn classifications, outposts, open files, control counts.
- **Engine**: from Stockfish. This covers candidate lines, evaluations, the per-move eval strip, "why not" costs, and the opponent's threat (found with a null-move search: "if you passed, they'd play…").
- **Idea**: strategic interpretations such as pawn breaks, knight routes, rook lifts and castling. Each plan lists the conditions it depends on, checked against the board, and is upgraded to *Engine* only if an engine line actually plays it.

Explanations are written from templates over these facts. **No language model writes or edits them**, so they can't invent moves or override the engine. The app never splits the evaluation into percentages for king safety, material and so on.

## Privacy

- Analysis and game review run locally in the browser. Imported games are fetched through this site's server from the public Chess.com and Lichess APIs, and are never stored.
- Screenshots and photos are read in the browser by the on-device reader (`src/lib/vision/local/`) and never uploaded. Only if the player chooses the optional AI reader is the cropped picture sent through this site's server to the configured vision API, held in memory for that request, and discarded. The UI says this next to the upload control.
- The side to move, castling rights and en passant are never inferred from a photo. The player sets them, and analysis stays blocked until they're valid.

## Licences

Stockfish is GPL-3.0, and this app ships it to browsers, so the project is licensed **GPL-3.0-or-later** (see `package.json`). The engine licence is served at `/engine/COPYING.txt`, and `/credits` lists the attributions. The piece artwork is the "mpchess" set by Maxime Chupin (GPL-3.0+), as distributed with Lichess. The fonts are Clash Display and Satoshi (Indian Type Foundry via Fontshare, ITF Free Font License, self-hosted in `src/fonts/`), plus Instrument Serif and Geist Mono (SIL OFL). The 3D hero uses three.js and React Three Fiber (MIT). chess.js is BSD-2-Clause. The opening book comes from the Lichess [chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0). The Brilliant/Great logic was informed by [WintrChess](https://github.com/WintrCat/wintrchess) (GPL-3.0); it is an independent reimplementation.

## Known limitations

- The on-device reader is built for screenshots and flat diagrams: 98.5% of squares right on a held-out set of unseen Chess.com and Lichess styles (`scripts/vision/README.md`). A few unusual piece sets still confuse it, and uncertain squares are marked for you to check. Angled photos of real boards go to the optional, less accurate AI reader.
- Crop and rotate are a rectangle plus straightening; there's no perspective (keystone) correction.
- Static facts use direct attacker/defender counts, not a full exchange evaluation. Where that matters, the text points to the engine line.
- The lite engine is weaker than full Stockfish (still far beyond human strength). Deep settings on slow phones can take a while.
- The eval strip uses quick depth-12 checks per move, which are shallower than the main analysis.
- Game review labels depend on depth. Very deep combinations may only show as Brilliant on "Thorough". Labels won't always match Chess.com's, which uses a stronger server engine.
- Chess.com game links can't be fetched (no per-game endpoint in the public API): enter the username or paste the PGN.
