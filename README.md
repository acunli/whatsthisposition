# WhatsThisPosition

An X-ray for chess positions, built for **whatsthisposition.com**. Snap a photo, paste a FEN or set up a board. After a 3D scan intro, the position's **threats, weaknesses, strengths and plans for both sides** light up on the squares, with Stockfish checking the concrete claims.

**What you get after analysing a position**

- **Scoreboard:** the verdict in words, the eval (mate shown separately), a tug-of-war eval bar, and each side's strength and weakness counts.
- **Story:** a guided tour of the most important findings, animated one by one on the board. It ends with the engine's move.
- **Strengths & weaknesses:** a Silman-style ledger for both sides, plus "what each side should try". Every item points at its squares.
- **Moves:** Stockfish's candidate lines played out move by move, with a per-move eval strip, "Why this move?", "Why not?", Compare, and "Try it first". You can also play your own move and ask about it.
- **Layers:** stackable overlays for threats, king safety, pawn structure, pieces, space & control, and material.
- **Plans:** conditional ideas (pawn breaks, knight routes, rook lifts, pushing passers, castling), each with what it depends on.

How each concept is detected and drawn, with sources, is in [`docs/position-understanding.md`](docs/position-understanding.md).

## Quick start

```bash
npm install          # also copies the Stockfish WASM build into public/engine
cp .env.example .env.local   # optional, only needed for photo recognition
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
| `npm run typecheck` | `tsc --noEmit` |

## Environment variables

Only photo recognition needs configuration. Without it, the photo tab explains that it isn't set up, and FEN and manual setup keep working.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For photo upload | Server-side key for the vision provider. Never sent to the browser. |
| `VISION_PROVIDER` | No (default `anthropic`) | Selects the provider in `src/lib/vision/provider.ts`. |
| `VISION_MODEL` | No (default `claude-opus-5-5`) | Model used to read the board. |

The provider sends one structured-output request per photo (JSON schema: 8×8 cells, each with `piece` and `confident`). It opts into Anthropic's server-side refusal fallback (`fallbacks: "default"`), and the result is re-validated with zod before use.

## How it's organised

```
src/lib/chess/      board geometry, attack maps, FEN parsing + validation
src/lib/engine/     UCI parsing, score normalization, EngineClient (Web Worker transport)
src/lib/facts/      visual facts per lens (threats, king, pawns, structure, space, tactics,
                    pieces, control, material), ledger, advice, tour, tracing,
                    move explanations, plans
src/lib/vision/     recognition schema, grid→board mapping, provider adapter (server-only)
src/lib/variation.ts  engine lines → verified moves, navigation
src/components/     BoardStage (animated board), home, setup flow, analysis arena,
                    scan intro
src/app/api/recognize  POST photo → recognized grid (nothing is stored)
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

- Analysis runs locally in the browser.
- Photos are held in memory for the recognition request, forwarded to Anthropic's API, and discarded. They are never written to disk or logged. The UI says this next to the upload control.
- The side to move, castling rights and en passant are never inferred from a photo. The player sets them, and analysis stays blocked until they're valid.

## Licences

Stockfish is GPL-3.0, and this app ships it to browsers, so the project is licensed **GPL-3.0-or-later** (see `package.json`). The engine licence is served at `/engine/COPYING.txt`, and `/credits` lists the attributions. The piece artwork is the "mpchess" set by Maxime Chupin (GPL-3.0+), as distributed with Lichess. The fonts are Big Shoulders, Hanken Grotesk and Martian Mono (SIL OFL). chess.js is BSD-2-Clause.

## Known limitations

- Photo recognition quality depends on the vision model. Angled, glare-heavy or partly covered boards may need manual fixes. The app marks uncertain squares and can't be told a board is "fine" until you confirm them.
- Crop and rotate are a rectangle plus straightening; there's no perspective (keystone) correction.
- Static facts use direct attacker/defender counts, not a full exchange evaluation. Where that matters, the text points to the engine line.
- The lite engine is weaker than full Stockfish (still far beyond human strength). Deep settings on slow phones can take a while.
- The eval strip uses quick depth-12 checks per move, which are shallower than the main analysis.
