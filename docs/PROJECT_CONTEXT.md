# WhatsThisPosition: project context

> **Read this first.** This is the hand-off document for any AI or developer working
> on the project. It is updated in the same commit as every change: keep it
> current, and append to the progress log at the bottom.

## 1. What this is

**whatsthisposition.com** is a chess website for **intermediate players**. You give it a
position (photo, FEN or hand setup). It shows *why* the engine prefers a side:
threats, weaknesses, strengths and plans **for both sides**, drawn and animated on the
board, with Stockfish checking the concrete claims. It must be **visual and
interactive, not a wall of text**. Every claim is tied to squares, pieces or lines.

Non-negotiables from the original brief:
- The side to move, castling rights and en passant are **never inferred from a photo**. The player sets them.
- Photos are not stored. API keys stay server-side.
- No invented moves or unsupported claims. Every item is labelled **Board fact** (rules), **Engine** (Stockfish) or **Idea** (interpretation).
- Never split the evaluation into fake percentages ("40% king safety").
- Stockfish runs as WebAssembly in a Web Worker (no UI blocking), with progress, depth/time setting and cancel.
- Motion only where it explains something. Respect `prefers-reduced-motion`.
- No auth, billing, deploys or domain purchases.

## 2. Owner preferences (standing rules)

- **Git:** commits are authored only by the owner (`ayushman-2008 <ayushman.chaudhuri@gmail.com>`). **No `Co-Authored-By: Claude` or "Generated with Claude Code" lines, ever.** Commit **and push** frequently at milestones. Remote: `origin` = `https://github.com/acunli/whatsthisposition.git`, branch `main`.
- **This document** must be updated with every change (see the progress log).
- **Design feedback so far:**
  - v1 (warm paper, Fraunces serif) was called "extremely AI generated".
  - v2 (dark "X-ray" theme, Big Shoulders condensed font, pixel "?" logo) was called "pathetic": the font, the logo and a "pathetically basic" landing page.
  - The owner wants a **design marvel**: exciting, premium, lots of purposeful animation, with a strong logo.
- **Analysis feedback:** the explanations must come from **looking deep into the engine's lines**, not one-move static checks. The **best move comes first** in the story. Brilliant or sacrificial moves must be explained: what happens if the sacrifice is accepted, what the move threatens, what it takes away from the opponent. Reference test position: `7r/1pp1nk2/2n2p2/1bPp2q1/3P3p/rPB2RP1/5Q1P/2NBR1K1 w - - 3 43`, where **43.g4!!** is best (Stockfish lite, depth 22: g4 +2.66, Kh1 +2.02, h3 +1.59). If ...Qxg4+ then Kh1 and White's rooks use the g-file (+3.68). After ...h3, Rg3 follows. g4 takes f5 and h5 from the queen and opens f2–h4 for the white queen.
- **Eval bar:** vertical, next to the board.
- **Vision provider:** the owner uses the **NUS SoCLaaS gateway** (OpenAI-compatible, Qwen) with a school key.

## 3. Stack and commands

- Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), plain CSS (`src/app/globals.css`), no CSS framework.
- `chess.js` 1.4 for rules and move generation. `stockfish` 19.0.0 npm package (Stockfish.js, **lite single-threaded WASM**, about 1.8 MB) copied to `public/engine/` by `scripts/copy-engine.mjs` (on postinstall, predev and prebuild; `public/engine/` is gitignored).
- Vision: `openai` SDK (OpenAI-compatible providers such as SoCLaaS) and `@anthropic-ai/sdk` (optional). `zod` validates model output.
- Tests: Vitest (`src/**/*.test.ts`), including a **real Stockfish integration test** run in Node.
- Commands: `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run vision:check`.
- Licence: **GPL-3.0-or-later** (because Stockfish is shipped to browsers). Pieces: "mpchess" by Maxime Chupin (GPL-3.0+).

## 4. Environment and secrets

`.env.local` (gitignored) holds the owner's key. The template is `.env.example`:

```
VISION_PROVIDER=soclaas            # or anthropic; unset = first provider with a key
SOCLAAS_BASE_URL=https://soclaas-api.comp.nus.edu.sg/v1
SOCLAAS_API_KEY=                   # school key goes here
SOCLAAS_MODEL=default              # must accept images; check with npm run vision:check
# ANTHROPIC_API_KEY= / VISION_MODEL=claude-opus-5-5 (optional alternative)
```

`npm run vision:check [model]` lists the gateway's models and sends a tiny red PNG to confirm the model can see images. **Whether SoCLaaS's "default" Qwen model accepts images is unverified.** Qwen3 text models can't. If the check fails, pick a VL model id.

## 5. Architecture map

```
src/app/
  page.tsx                  → <Studio/> (client state machine: home → setup → analysis)
  credits/page.tsx          → how it works, privacy, licences
  api/recognize/route.ts    → POST multipart image → provider → validated 8×8 grid (nothing stored); GET → {configured, provider}
  globals.css               → the whole design system (tokens, board overlays, pages)
src/components/
  Studio.tsx                → top bar, stage switching, ?fen= deep links
  Logo.tsx                  → logo mark and wordmark
  BoardStage.tsx            → THE board: 64 div squares + overlay spans (fill/flood/pulse/ring/dashed/dot/hatch/pit),
                               file/rank bands, sliding pieces, SVG arrows (knight arrows bend), links, icons, badges
  home/                     → Home (hero, dock, sections), Showcase (looping demo tour), Concepts (8 animated tiles)
  setup/                    → SetupView (editor + details + validation), PhotoInput (drop/crop/rotate/orientation/recognise), PiecePalette
  analysis/                 → AnalysisView (orchestrator and spotlight logic), Scoreboard, ScanIntro (3D scan animation),
                               StoryPanel (guided tour), LedgerPanel (strengths/weaknesses and advice), LayersPanel,
                               LinesPanel (candidates + why/why-not), ComparePanel, QuizPanel ("try it first"),
                               PlansPanel, VariationBar (+eval strip), useAnalysis (all engine work), bits
src/lib/
  chess/        board.ts (geometry, attack maps), fen.ts (parse/serialise/validate with square-tagged issues), types.ts
  engine/       uci.ts (parsing), score.ts (side-to-move → White-view normalisation, mate kept separate),
                client.ts (EngineClient: queue, multipv, searchmoves, cancel), browser.ts (worker singleton)
  facts/        context.ts (memoised attacks/pins/en prise/safe squares), threats.ts, king.ts, pawns.ts, structure.ts
                (holes, colour complexes, chains, majorities, hanging pawns), space.ts, tactics.ts (skewers, discoveries,
                back rank, king-danger units), pieces.ts (dominant/worst piece, 7th rank, rim, development), activity.ts,
                control.ts, material.ts, plans.ts, trace.ts, explain.ts (move points incl. prophylaxis and opening lines),
                engineFacts.ts (null-move threat), ledger.ts (strength/weakness sorting and labels), advice.ts, tour.ts, index.ts (LENSES)
  vision/       grid.ts (schema, grid→board mapping), compact.ts (8-row compact format for OpenAI-compatible models),
                openaiCompatible.ts (SoCLaaS), anthropic.ts, provider.ts (selection), types.ts
  deep/         deep.ts (line-based move understanding: classification, offers/sacrifices incl. "looks loose but
                tactically protected", concrete threats via null move, key moments, settled outcome, comparison),
                scenes.ts (story chapters about the best move, with in-line position previews)
  variation.ts  UCI line → verified SAN moves with FENs, navigation
docs/
  PROJECT_CONTEXT.md        (this file)
  position-understanding.md (research: concept → detection → board visual, with sources)
```

## 6. How analysis works

1. **Validation** (`fen.ts`): kings, back-rank pawns, the side not to move in check, castling vs placement, en passant, promotion counts.
2. **Engine** (`useAnalysis`): main multi-PV search (presets: depth 12/16/20/24 or 5s/15s, 1–5 lines). Then a **null-move probe** (the opponent's threat), then **depth-12 checks for every position along the selected line** (eval strip), plus on-demand `searchmoves` for "why not my move?". All scores are normalised to White's view once, in `normalizeScore`.
3. **Board facts** (`computeFacts(fen, hints)`): per lens (threats, king, pawns, activity, control, material). Each fact carries `side`, `tone`, `evidence`, `marks` (squares/arrows/links/icons/bands/badges with animation order), `priority`, optional `polarity` and `label`.
4. **Ledger** (`buildLedger`): facts sorted into strengths and weaknesses per side (polarity rules in `ledger.ts`).
5. **Advice** (`buildAdvice`): now / fix / attack / use, per side. It is engine-aware: it won't advise grabbing material the engine declines, and a mate in one comes first.
6. **Tour** (`buildTour`): urgent tactics, then alternating sides. The analysis view appends the engine's best move.
7. **Deep move understanding** (`lib/deep/deep.ts`, run by `useAnalysis.requestDeep`). This runs automatically for the best move once the search settles, and on demand for "Why X?". Side searches are injected (`Searcher`) and run at **depth 16–20**, because shallower searches misjudge sacrifices (on the g4 position, depth 12–14 still thinks ...Qxg4 is fine). The steps:
   - One multi-PV search of the position after the move. That gives the opponent's best replies and a deeper main line, which **overrides the root PV when they disagree**.
   - **Offers:** material that becomes takeable because of the move (the moved piece, or newly loose pieces). Each is searched on its own and compared like for like with the best non-capture reply. "Poisoned" means taking is at least 0.35 worse for the taker. Pieces that were **already loose** are also tested and reported as "looks loose but tactically protected".
   - **Threat:** a null-move search after the move, kept only if concrete (mate, a capture, a check, or material won).
   - **Key moments:** loud moves in the deeper line. **Outcome:** material at a settled point (not mid-exchange) plus the eval.
   - **Classification:** brilliant (best, a real sacrifice, not already crushing), only move (gap ≥ 1.5), great (≥ 0.6), best; non-best moves as inaccuracy (?!), mistake (?) or blunder (??).
   - **Story:** chapters about the best move come first (the move, "what if it's taken" with a board preview of the refutation, the threat, what it does, where it leads), then the position's findings.
8. **Move explanations** (`explain.ts`): captures, checks, new targets, rescues, concessions, prophylaxis ("takes b4 away from…"), opening lines ("opens the way for the bishop on c1"), outposts, open files, structure changes, castling rights; material swing along the line; why-not compares against the best line.

Colour meanings (fixed): red = danger/weakness, gold = strength/opportunity, sky = White's influence, violet = Black's influence, lime (dashed) = idea, ink = neutral.

## 7. Decisions and rejected ideas

- Custom div-based board instead of a chessboard library, for full control of layered animated overlays.
- No LLM writes explanations; they come from templates over verified facts. An LLM is only used to read photos.
- **Rejected: "engine piece worth"** (static eval with a piece removed). Stockfish 19's eval is normalised to win-rate, so it produced nonsense (queen 5.7, bishop 8.9).
- Engine hints are used for root facts only after the search settles, so the tour doesn't reshuffle mid-search.
- King-danger, hole and back-rank rules are gated to avoid false alarms (no enemy pieces → no king danger; holes need 4+ pawns and a usable square; back-rank needs an enemy heavy piece that can reach it).

## 8. Known limitations

- Recognition accuracy depends on the model. There is no perspective (keystone) correction when cropping.
- Static facts use attacker/defender counts, not full exchange evaluation.
- The lite engine is weaker than full Stockfish. Eval-strip checks are depth 12.
- Deep analysis explains the best move (and any "Why X?"). "Why not" still uses the lighter comparison (`explainWhyNot`) plus a classification badge.
- Deep analysis takes a few seconds in the browser (3–5 extra searches at depth 16+). The story holds autoplay until it finishes.

## 9. Backlog (owner requests not yet done)

- [ ] Complete design overhaul, round 3: premium fonts, a real logo, a rich landing page with 3D and scroll storytelling.

## 10. Progress log

- **2026-09-30** · Initial app: FEN/photo/manual input, Stockfish worker, six lenses, candidate lines, why/why-not, compare, try-it-first, plans, tests. (commit `28343c5`)
- **2026-09-30** · Research doc `docs/position-understanding.md`. (`0754667`)
- **2026-09-30** · Analysis layer: structure, space, tactics, pieces, ledger, advice, tour. (`2328392`)
- **2026-09-30** · Redesign v2 (dark X-ray theme, BoardStage, scan intro, story/ledger/layers/moves/plans, mpchess pieces); piece-worth idea rejected. (`7534ed4`)
- **2026-09-30** · Quiet-move explanations (prophylaxis, opening lines); README refresh. (`c76e372`)
- **2026-09-30** · Added this context doc, `AGENTS.md`/`CLAUDE.md` pointers; SoCLaaS (OpenAI-compatible, Qwen) vision provider with compact 8-row format, `<think>` stripping, one retry, typed errors; `.env.example`/`.env.local` templates; `npm run vision:check`.
- **2026-09-30** · Deep move understanding (`lib/deep`): classification (brilliant/only/great/best, ?!/?/??), poisoned-offer and "tactically protected" detection with refutation lines, concrete threats, key moments, settled outcome, comparison; the story now **starts with the best move** and previews positions inside lines; "Why X?" shows the new DeepCard; explanations gained "uncovers the queen on f2: it now hits h4". **Vertical eval bar beside the board** (horizontal tug removed). Real-engine test on the g4 reference position. tsconfig excludes iCloud "… 2.*" duplicates.
