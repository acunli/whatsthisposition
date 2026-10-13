/**
 * Game review: analyse every position of a game (in parallel across engines),
 * then classify every move. The engine work is injected (`Searcher`), so the same
 * code runs in the browser (worker pool) and in tests (Node engine).
 */
import { Chess } from "chess.js";
import type { Searcher } from "../deep/deep";
import type { OpeningBook } from "./book";
import { classifyMove, expectedScore, gameRating, needsQuietSearch, terminalEval, type ClassifiedMove, type PositionAnalysis, type TheoryInfo, type TheoryOption } from "./classify";
import { isTheory, mainLine, type MasterEntry, type MasterMove, type MastersBook } from "./masters";
import type { SideLine } from "./lines";
import type { GameMove, ParsedGame } from "./pgn";
import { detectSacrifice, unsafePieces } from "./safety";

export interface ReviewOptions {
  depth: number;
  /** Only these position indices (default: all). Others keep their value from `existing`. */
  indices?: number[];
  existing?: (PositionAnalysis | null)[];
  /** Called whenever one position finishes (index 0 = start position). */
  onPosition?: (index: number, analysis: PositionAnalysis) => void;
  signal?: { cancelled: boolean };
}

/** All positions of the game: the start, then after each move. */
export function gamePositions(game: ParsedGame): string[] {
  return [game.startFen, ...game.moves.map((m) => m.fenAfter)];
}

/**
 * Analyses positions with a pool of searchers (one job per engine at a time),
 * in game order so the review fills in from the first move. A searcher that fails
 * drops out and its position goes back in the queue; the run only fails if every
 * searcher has failed.
 */
export async function analysePositions(game: ParsedGame, searchers: Searcher[], opts: ReviewOptions): Promise<(PositionAnalysis | null)[]> {
  const fens = gamePositions(game);
  const results: (PositionAnalysis | null)[] = fens.map((_, i) => opts.existing?.[i] ?? null);
  const queue = opts.indices ? [...opts.indices].sort((a, b) => a - b) : fens.map((_, i) => i);
  let alive = searchers.length;
  let lastError: unknown = null;
  const worker = async (search: Searcher) => {
    while (queue.length && !opts.signal?.cancelled) {
      const i = queue.shift()!;
      const fen = fens[i];
      const terminal = terminalEval(fen);
      let pa: PositionAnalysis;
      if (terminal) {
        if (results[i]) continue;
        pa = { lines: [], eval: terminal, depth: 0 };
      }
      else {
        let lines;
        try {
          // A fresh hash per position makes the review reproducible whichever engine gets which position.
          lines = await search({ fen, depth: opts.depth, multipv: 2, fresh: true });
        } catch (e) {
          if (opts.signal?.cancelled) return;
          queue.unshift(i);
          lastError = e;
          alive--;
          return;
        }
        if (!lines.length) continue;
        pa = { lines, eval: lines[0].eval, depth: lines[0].depth };
      }
      results[i] = pa;
      opts.onPosition?.(i, pa);
    }
  };
  await Promise.all(searchers.map(worker));
  if (!alive && !opts.signal?.cancelled) throw lastError instanceof Error ? lastError : new Error("The engine stopped.");
  return results;
}

export interface RunProgress {
  /** First-pass positions analysed, of `total`. */
  analysed: number;
  total: number;
  /** Second-pass searches (deeper, or the quiet move behind a sacrifice) done, of those known so far. */
  verified: number;
  toVerify: number;
  /** Estimated share of the whole review done (0–1), counting searches still running by their elapsed time. */
  share: number;
}

/** A search 4 plies deeper takes about 3.5 times as long as the first-pass search of the same position. */
const DEEP_FACTOR = 3.5;

export interface RunOptions {
  depth: number;
  /** Depth of the second-pass searches. */
  verifyDepth: number;
  /** The opening book: second-pass choices wait for it, so they don't depend on when it loads. */
  book: Promise<OpeningBook | null>;
  signal?: { cancelled: boolean };
  /** A position's analysis, whenever it is new or deeper (index 0 = start position). */
  onPosition?: (index: number, analysis: PositionAnalysis) => void;
  onProgress?: (p: RunProgress) => void;
}

/**
 * The whole review on a pool of searchers, as one queue so no engine sits idle: every position
 * at `depth` in game order; as soon as a move's first-pass labels are known, the positions behind
 * tactical labels are searched `verifyDepth` deep (the slowest first, so the last one doesn't hold
 * up the end); and once a sacrifice's positions are final, the best quiet move it is measured
 * against. Which positions get the second pass is decided exactly as by `criticalPositions` and
 * `quietSearchPositions` on the finished passes, so the result doesn't depend on timing.
 */
export async function runReview(game: ParsedGame, searchers: Searcher[], opts: RunOptions): Promise<(PositionAnalysis | null)[]> {
  const fens = gamePositions(game);
  const n = fens.length;
  const first: (PositionAnalysis | null)[] = Array(n).fill(null);
  const merged: (PositionAnalysis | null)[] = Array(n).fill(null);
  const cost: number[] = Array(n).fill(0);
  const firstQueue = fens.map((_, i) => i);
  const deepWanted = new Set<number>();
  const deepStarted = new Set<number>();
  const deepDone = new Set<number>();
  const quietWanted = new Set<number>();
  const quietStarted = new Set<number>();
  const quietDone = new Set<number>();
  const cacheFirst: ClassifyCache = new Map();
  const cacheMerged: ClassifyCache = new Map();
  let analysed = 0;
  let running = 0;
  let book: OpeningBook | null | undefined;
  let alive = searchers.length;
  let lastError: unknown = null;
  let wake: (() => void)[] = [];
  const notify = () => {
    const w = wake;
    wake = [];
    for (const f of w) f();
  };
  void opts.book.then(
    (b) => {
      book = b;
      plan();
      notify();
    },
    () => {
      book = null;
      plan();
      notify();
    },
  );

  // For the share of work done: each search's expected length (first-pass searches by their average
  // so far, deeper ones from their own first-pass time) and when the running ones started.
  const started = new Map<string, number>();
  const firstAvg = () => {
    const done = cost.filter((c) => c > 0);
    return done.length ? done.reduce((a, b) => a + b, 0) / done.length : 2000;
  };
  const expect = (kind: "first" | "deep" | "quiet", i: number) =>
    kind === "first" ? firstAvg() : kind === "deep" ? DEEP_FACTOR * Math.max(cost[i], firstAvg() / 2) : 2 * firstAvg();
  const share = () => {
    let done = 0;
    let left = 0;
    for (let i = 0; i < n; i++) if (first[i]) done += expect("first", i);
    for (const k of deepDone) done += expect("deep", k);
    for (const i of quietDone) done += expect("quiet", i);
    left += firstQueue.length * firstAvg();
    for (const k of deepWanted) if (!deepDone.has(k) && !deepStarted.has(k)) left += expect("deep", k);
    for (const i of quietWanted) if (!quietDone.has(i) && !quietStarted.has(i)) left += expect("quiet", i);
    const now = Date.now();
    for (const [key, t0] of started) {
      const [kind, i] = key.split(":") as ["first" | "deep" | "quiet", string];
      const e = expect(kind, Number(i));
      const ran = Math.min(now - t0, 0.95 * e);
      done += ran;
      left += e - ran;
    }
    return done + left > 0 ? done / (done + left) : 0;
  };
  const progress = () =>
    opts.onProgress?.({ analysed, total: n, verified: deepDone.size + quietDone.size, toVerify: deepWanted.size + quietWanted.size, share: share() });
  const ticker = opts.onProgress ? setInterval(progress, 500) : null;

  /** What the second pass needs, from what is known now. */
  const plan = () => {
    if (book === undefined) return;
    // First-pass labels decide the deeper searches, as criticalPositions does on the finished first pass.
    const r1 = classifyGame(game, first, book, cacheFirst);
    for (const k of criticalPositions(r1, first, opts.verifyDepth)) deepWanted.add(k);
    // A position is final once the moves on both sides of it have first-pass labels and any deeper search is back.
    const decided = (k: number) => r1.moves.length >= Math.min(k + 1, game.moves.length);
    const final = (k: number) => !!merged[k] && decided(k) && (!deepWanted.has(k) || deepDone.has(k));
    const r2 = classifyGame(game, merged, book, cacheMerged);
    for (const i of quietSearchPositions(game, r2, merged)) if (final(i) && final(i + 1) && !quietDone.has(i)) quietWanted.add(i);
    progress();
  };

  const next = (): { kind: "first" | "deep" | "quiet"; i: number } | null => {
    if (firstQueue.length) return { kind: "first", i: firstQueue.shift()! };
    let best = -1;
    for (const k of deepWanted) if (!deepStarted.has(k) && first[k] && (best < 0 || cost[k] > cost[best])) best = k;
    if (best >= 0) return { kind: "deep", i: best };
    for (const i of quietWanted) if (!quietStarted.has(i)) return { kind: "quiet", i };
    return null;
  };
  const finished = () =>
    !firstQueue.length && !running && book !== undefined && [...deepWanted].every((k) => deepDone.has(k)) && [...quietWanted].every((i) => quietDone.has(i));

  const set = (i: number, pa: PositionAnalysis) => {
    merged[i] = pa;
    opts.onPosition?.(i, pa);
  };

  const worker = async (search: Searcher) => {
    for (;;) {
      if (opts.signal?.cancelled) return;
      const job = next();
      if (!job) {
        if (finished()) return;
        await new Promise<void>((r) => wake.push(r));
        continue;
      }
      const { kind, i } = job;
      if (kind === "deep") deepStarted.add(i);
      if (kind === "quiet") quietStarted.add(i);
      running++;
      started.set(`${kind}:${i}`, Date.now());
      try {
        if (kind === "first") {
          const terminal = terminalEval(fens[i]);
          if (terminal) {
            first[i] = { lines: [], eval: terminal, depth: 0 };
          } else {
            const t0 = Date.now();
            // A fresh hash per search keeps the review reproducible whichever engine gets what.
            const lines = await search({ fen: fens[i], depth: opts.depth, multipv: 2, fresh: true });
            cost[i] = Date.now() - t0;
            if (lines.length) first[i] = { lines, eval: lines[0].eval, depth: lines[0].depth };
          }
          if (first[i]) {
            analysed++;
            set(i, first[i]!);
          }
        } else if (kind === "deep") {
          const lines = await search({ fen: fens[i], depth: opts.verifyDepth, multipv: 2, fresh: true });
          if (lines.length) set(i, { lines, eval: lines[0].eval, depth: lines[0].depth, quiet: merged[i]?.quiet });
          deepDone.add(i);
        } else {
          const m = game.moves[i];
          const quiet = quietMoves(m, i > 0 ? game.moves[i - 1] : null);
          const line = quiet.length ? (await search({ fen: m.fenBefore, depth: opts.verifyDepth, multipv: 1, searchmoves: quiet, fresh: true }))[0] : undefined;
          if (line && merged[i]) set(i, { ...merged[i]!, quiet: line });
          quietDone.add(i);
        }
      } catch (e) {
        running--;
        started.delete(`${kind}:${i}`);
        if (opts.signal?.cancelled) return;
        // This engine is out: its job goes back for the others.
        if (kind === "first") firstQueue.unshift(i);
        if (kind === "deep") deepStarted.delete(i);
        if (kind === "quiet") quietStarted.delete(i);
        lastError = e;
        alive--;
        notify();
        return;
      }
      running--;
      started.delete(`${kind}:${i}`);
      plan();
      notify();
    }
  };
  try {
    await Promise.all(searchers.map(worker));
  } finally {
    if (ticker) clearInterval(ticker);
  }
  if (!opts.signal?.cancelled && (!alive || firstQueue.length)) throw lastError instanceof Error ? lastError : new Error("The engine stopped.");
  return merged;
}

export interface GameReview {
  moves: ClassifiedMove[];
  /** Index of the last move that is part of opening theory (−1 if none). */
  bookUntil: number;
  opening: { eco: string; name: string } | null;
  /** Where the master statistics come from, when the master book loaded. */
  masters: { games: number; minElo: number } | null;
}

/** Master choices at `fen` (up to `max`, theory moves only), each with the line masters follow after it. */
export function theoryAt(masters: MastersBook, fen: string, entry: MasterEntry, played: MasterMove | null, max = 4): TheoryInfo {
  const c = new Chess(fen);
  const options: TheoryOption[] = [];
  for (const mv of entry.moves) {
    if (options.length >= max) break;
    if (!isTheory(entry, mv.uci)) continue;
    let san: string;
    let after: string;
    try {
      san = c.move({ from: mv.uci.slice(0, 2), to: mv.uci.slice(2, 4), promotion: mv.uci[4] }).san;
      after = c.fen();
      c.undo();
    } catch {
      continue;
    }
    options.push({ ...mv, san, line: mainLine(masters, after, 9) });
  }
  return { games: entry.total, played, options };
}

/**
 * Classifies every move whose before/after positions are analysed, stopping at the
 * first gap (so a partially analysed game gives a correct prefix). Pass the same
 * `cache` while a run fills in to avoid re-classifying the finished prefix.
 */
export type ClassifyCache = Map<number, { c: ClassifiedMove; prev?: ClassifiedMove; quiet?: PositionAnalysis["quiet"] }>;

export function classifyGame(game: ParsedGame, positions: (PositionAnalysis | null)[], book: OpeningBook | null, cache?: ClassifyCache): GameReview {
  const masters = book?.masters ?? null;
  const run = classifyRun(game.moves, (i) => positions[i], book, gameRating(game.whiteElo, game.blackElo), { stillBook: true, bookUntil: -1, opening: null }, cache);
  return { moves: run.moves, bookUntil: run.state.bookUntil, opening: run.state.opening, masters: masters ? { games: masters.games, minElo: masters.minElo } : null };
}

/** Where a run of moves starts: still in book or not, the opening so far, and the opponent's move before the first. */
interface RunState {
  stillBook: boolean;
  bookUntil: number;
  opening: { eco: string; name: string } | null;
  previous?: ClassifiedMove;
}

/**
 * Classifies `moves` in order while both sides of each are analysed (`positionAt(i)` is the
 * position before move i), stopping at the first gap. Shared by the game and its side lines,
 * so a line's moves are labelled exactly as the game's would be (book, Miss, rating gates).
 */
function classifyRun(
  moves: GameMove[],
  positionAt: (i: number) => PositionAnalysis | null | undefined,
  book: OpeningBook | null,
  rating: number | null,
  start: RunState,
  cache?: ClassifyCache,
): { moves: ClassifiedMove[]; state: RunState } {
  const out: ClassifiedMove[] = [];
  const masters = book?.masters ?? null;
  let { stillBook, bookUntil, opening } = start;
  for (let i = 0; i < moves.length; i++) {
    const before = positionAt(i);
    const after = positionAt(i + 1);
    if (!before || !after) break;
    const m = moves[i];
    // Theory: a named opening line, or a move strong players really choose here (and the
    // engine doesn't call a mistake: popular online traps aren't theory).
    const entry = stillBook && masters ? masters.get(m.fenBefore) : null;
    const sound = expectedScore(before.eval, m.color) - expectedScore(after.eval, m.color) < 0.1;
    const played = sound ? isTheory(entry, m.uci) : null;
    const wasBook = stillBook;
    const inBook = stillBook && (!!book?.inBook(m.fenAfter) || !!played);
    if (!inBook) stillBook = false;
    else bookUntil = m.ply - 1;
    const named = book?.name(m.fenAfter);
    if (named && stillBook) opening = named;
    const previous = i > 0 ? out[i - 1] : start.previous;
    const hit = cache?.get(i);
    if (hit && hit.c.evalBefore === before.eval && hit.c.evalAfter === after.eval && hit.prev === previous && hit.quiet === before.quiet && hit.c.move === m) {
      out.push(hit.c);
      continue;
    }
    const legal = new Chess(m.fenBefore).moves().length;
    // Book moves, and the move that left the book, carry what masters play here.
    const theory = wasBook && entry && masters ? theoryAt(masters, m.fenBefore, entry, played) : null;
    const c = classifyMove({ move: m, before, after, legalMoves: legal, inBook, previous, opening: inBook ? opening : null, theory, rating });
    cache?.set(i, { c, prev: previous, quiet: before.quiet });
    out.push(c);
  }
  return { moves: out, state: { stillBook, bookUntil, opening } };
}

/**
 * Labels a side line's moves with the game's rules. `positionAt(k)` is the position after k of
 * its moves (k = 0 is the game position it starts from); `base` is the game's review so far,
 * which says whether the game was still in book there and what the move before it was.
 */
export function classifyLine(
  game: ParsedGame,
  line: SideLine,
  positionAt: (k: number) => PositionAnalysis | null | undefined,
  book: OpeningBook | null,
  base: GameReview,
  cache?: ClassifyCache,
): ClassifiedMove[] {
  // In book where it starts when every game move up to there was book (the game may have stayed in book longer).
  const stillBook = base.moves.length >= line.from && base.bookUntil >= line.from - 1;
  const start: RunState = { stillBook, bookUntil: Math.min(base.bookUntil, line.from - 1), opening: stillBook ? base.opening : null, previous: line.from > 0 ? base.moves[line.from - 1] : undefined };
  return classifyRun(line.moves, positionAt, book, gameRating(game.whiteElo, game.blackElo), start, cache).moves;
}

/**
 * What a side line still needs from the engine, as the game gets in its two passes: positions
 * (k = moves into the line) to search `depth + VERIFY_EXTRA` deep around tactical labels, and
 * positions whose sacrifice needs the best quiet move searched.
 */
export function lineChecks(game: ParsedGame, line: SideLine, labels: ClassifiedMove[], positionAt: (k: number) => PositionAnalysis | null | undefined, base: GameReview, minDepth: number): { deeper: number[]; quiet: number[] } {
  // The game up to the line, then the line: the same selection rules as the game's second pass.
  const moves = [...game.moves.slice(0, line.from), ...line.moves];
  const positions = moves.map((_, i) => (i < line.from ? null : (positionAt(i - line.from) ?? null)));
  positions.push(positionAt(line.moves.length) ?? null);
  const review: GameReview = { ...base, moves: [...base.moves.slice(0, line.from), ...labels] };
  if (review.moves.length < line.from) return { deeper: [], quiet: [] };
  const lineGame = { ...game, moves };
  const own = (i: number) => i >= line.from;
  return {
    deeper: criticalPositions(review, positions, minDepth).filter(own).map((i) => i - line.from),
    quiet: quietSearchPositions(lineGame, review, positions).filter(own).map((i) => i - line.from),
  };
}

/** The moves from before `move` that give no material away (what a sacrifice is measured against), besides the move itself. */
export function quietMoves(move: GameMove, prev: GameMove | null): string[] {
  const declined = prev ? unsafePieces(prev.fenBefore, move.color) : [];
  return new Chess(move.fenBefore)
    .moves({ verbose: true })
    .map((x) => x.lan)
    .filter((u) => u !== move.uci && !detectSacrifice(move.fenBefore, u, declined)?.pieces.length);
}

const CRITICAL = new Set(["brilliant", "great", "mistake", "miss", "blunder"]);

/**
 * Positions worth a deeper second look: both sides of every move whose label is
 * decided by tactics (sacrifices, only-moves, errors). A shallow search can
 * misjudge exactly these, so the review re-searches them before the labels settle.
 */
export function criticalPositions(review: GameReview, positions: (PositionAnalysis | null)[], minDepth: number): number[] {
  const out = new Set<number>();
  review.moves.forEach((m, i) => {
    // Sacrifices count too: a near-best sacrifice at the first depth may be the best move deeper.
    if (!CRITICAL.has(m.cls) && !m.sacrifice?.pieces.length) return;
    for (const k of [i, i + 1]) if (positions[k]?.lines.length && positions[k]!.depth < minDepth) out.add(k);
  });
  return [...out].sort((a, b) => a - b);
}

/**
 * Positions whose move is a sacrifice and the engine's top move, but isn't Brilliant yet because
 * the second-best line is a sacrifice too: the best move that gives nothing away has to be
 * searched before the sacrifice can be measured (classify.ts, quietAlternative).
 */
export function quietSearchPositions(game: ParsedGame, review: GameReview, positions: (PositionAnalysis | null)[]): number[] {
  const out: number[] = [];
  review.moves.forEach((m, i) => {
    const before = positions[i];
    if (!before || m.cls === "brilliant" || !m.sacrifice?.pieces.length || m.bestUci !== m.move.uci) return;
    const prev = i > 0 ? game.moves[i - 1] : null;
    if (needsQuietSearch(m.move.fenBefore, m.move.uci, before, prev ? unsafePieces(prev.fenBefore, m.move.color) : [])) out.push(i);
  });
  return out;
}

/**
 * Searches, in each of `indices`, the best move that gives no material away (`PositionAnalysis.quiet`),
 * with the searchers in parallel. A failed search just leaves that position without one.
 */
export async function searchQuietMoves(
  game: ParsedGame,
  positions: (PositionAnalysis | null)[],
  indices: number[],
  searchers: Searcher[],
  opts: { depth: number; signal?: { cancelled: boolean }; onPosition?: (index: number, analysis: PositionAnalysis) => void },
): Promise<(PositionAnalysis | null)[]> {
  const out = positions.slice();
  const queue = [...indices];
  const worker = async (search: Searcher) => {
    while (queue.length && !opts.signal?.cancelled) {
      const i = queue.shift()!;
      const m = game.moves[i];
      const pa = out[i];
      if (!m || !pa) continue;
      const quiet = quietMoves(m, i > 0 ? game.moves[i - 1] : null);
      if (!quiet.length) continue;
      try {
        const line = (await search({ fen: m.fenBefore, depth: opts.depth, multipv: 1, searchmoves: quiet, fresh: true }))[0];
        if (!line) continue;
        out[i] = { ...pa, quiet: line };
        opts.onPosition?.(i, out[i]!);
      } catch {
        if (opts.signal?.cancelled) return;
      }
    }
  };
  await Promise.all(searchers.map(worker));
  return out;
}

/** Counts per class and colour, for the summary table. */
export function tally(moves: ClassifiedMove[]) {
  const t: Record<string, { w: number; b: number }> = {};
  for (const m of moves) {
    t[m.cls] ??= { w: 0, b: 0 };
    t[m.cls][m.move.color]++;
  }
  return t;
}
