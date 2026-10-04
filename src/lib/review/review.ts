/**
 * Game review: analyse every position of a game (in parallel across engines),
 * then classify every move. The engine work is injected (`Searcher`), so the same
 * code runs in the browser (worker pool) and in tests (Node engine).
 */
import { Chess } from "chess.js";
import type { Searcher } from "../deep/deep";
import type { OpeningBook } from "./book";
import { classifyMove, terminalEval, type ClassifiedMove, type PositionAnalysis } from "./classify";
import type { ParsedGame } from "./pgn";

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

export interface GameReview {
  moves: ClassifiedMove[];
  /** Index of the last move that is part of opening theory (−1 if none). */
  bookUntil: number;
  opening: { eco: string; name: string } | null;
}

/**
 * Classifies every move whose before/after positions are analysed, stopping at the
 * first gap (so a partially analysed game gives a correct prefix). Pass the same
 * `cache` while a run fills in to avoid re-classifying the finished prefix.
 */
export type ClassifyCache = Map<number, { c: ClassifiedMove; prev?: ClassifiedMove }>;

export function classifyGame(game: ParsedGame, positions: (PositionAnalysis | null)[], book: OpeningBook | null, cache?: ClassifyCache): GameReview {
  const out: ClassifiedMove[] = [];
  let stillBook = true;
  let bookUntil = -1;
  let opening: { eco: string; name: string } | null = null;
  for (let i = 0; i < game.moves.length; i++) {
    const before = positions[i];
    const after = positions[i + 1];
    if (!before || !after) break;
    const m = game.moves[i];
    const inBook = stillBook && !!book?.inBook(m.fenAfter);
    if (!inBook) stillBook = false;
    else bookUntil = i;
    const named = book?.name(m.fenAfter);
    if (named && stillBook) opening = named;
    const previous = out[i - 1];
    const hit = cache?.get(i);
    if (hit && hit.c.evalBefore === before.eval && hit.c.evalAfter === after.eval && hit.prev === previous) {
      out.push(hit.c);
      continue;
    }
    const legal = new Chess(m.fenBefore).moves().length;
    const c = classifyMove({ move: m, before, after, legalMoves: legal, inBook, previous, opening: inBook ? opening : null });
    cache?.set(i, { c, prev: previous });
    out.push(c);
  }
  return { moves: out, bookUntil, opening };
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
    if (!CRITICAL.has(m.cls)) return;
    for (const k of [i, i + 1]) if (positions[k]?.lines.length && positions[k]!.depth < minDepth) out.add(k);
  });
  return [...out].sort((a, b) => a - b);
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
