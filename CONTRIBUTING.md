# Contributing to what’sthisposition

Thanks for helping. Bug reports, ideas, explanation fixes and code are all welcome.

## Getting started

```bash
git clone https://github.com/acunli/whatsthisposition.git
cd whatsthisposition
npm install        # copies the Stockfish build into public/engine
npm run dev        # http://localhost:3000
```

Before opening a pull request, run what CI runs:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

`npm test` includes real Stockfish searches in Node, so it takes a few minutes. `npm run ext:build` builds the Chess.com extension into `extension/dist` (see [extension/README.md](extension/README.md)).

## The two rules

1. **Every explanation must come from the board or the engine.** A reason is a fact about the position ("the knight on c3 attacks the rook on a4") or the result of an engine search ("after 30…Qxa4 31.Be7, White threatens mate"). No invented reasons, no guessing from the evaluation alone, and no language model writing explanations.
2. **Fix rules in general terms, never for one position.** If an explanation reads badly, find the rule that produced it (`src/lib/reason/`, `src/lib/review/explain.ts`) and fix the rule, then check it on games you haven't read yet. The evaluation tools in [`scripts/eval/`](scripts/eval/README.md) make that loop quick: explanation reports on real games, the top-player Brilliant corpus, accuracy against Chess.com, book coverage.

## Where things live

- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md): how every part works, with the exact rules.
- [docs/position-understanding.md](docs/position-understanding.md): research notes behind the analysis design.

## Style

- TypeScript strict, React 19 with the React-compiler lint rules (no setState in effects, no reading refs during render).
- Plain CSS in `src/app/globals.css`; colours are tokens on `:root`.
- Write UI copy in plain words, in sentence case, from the player's point of view.
- Respect reduced motion; keep everything working without WebGL.
- Match the surrounding code's naming and comment density. Don't run Prettier on the code base (it isn't used).

## Licence

By contributing you agree that your contribution is licensed under the GNU GPL v3 or later, like the rest of the project.
