/**
 * Evaluation normalization.
 *
 * UCI engines (Stockfish included — verified in src/lib/engine/stockfish.test.ts)
 * report `score cp` / `score mate` from the perspective of the SIDE TO MOVE.
 * Everything in the UI uses White's perspective, so every raw score passes
 * through `normalizeScore` exactly once, together with the side to move of the
 * position that was searched.
 */
import type { Color } from "../chess/types";

/** Score as printed by the engine, side-to-move relative. */
export type RawScore = { kind: "cp"; value: number } | { kind: "mate"; value: number };

/**
 * White-relative evaluation.
 * - cp: centipawns, positive = White is better.
 * - mate: `moves` full moves until mate (0 = the position is already mate);
 *   `winner` is the side delivering mate.
 */
export type Evaluation = { kind: "cp"; cp: number } | { kind: "mate"; moves: number; winner: Color };

export function normalizeScore(raw: RawScore, sideToMove: Color): Evaluation {
  const sign = sideToMove === "w" ? 1 : -1;
  if (raw.kind === "cp") return { kind: "cp", cp: raw.value * sign };
  // "mate 0": the side to move has been mated. "mate N" > 0: side to move mates.
  const stmWins = raw.value > 0;
  const winner: Color = stmWins ? sideToMove : sideToMove === "w" ? "b" : "w";
  return { kind: "mate", moves: Math.abs(raw.value), winner };
}

const MATE_BASE = 100_000;

/**
 * Single number for sorting/comparison from White's view. Mates dominate every
 * centipawn score, and a faster mate is better for the winner.
 */
export function evalToNumber(e: Evaluation): number {
  if (e.kind === "cp") return e.cp;
  const magnitude = MATE_BASE - e.moves;
  return e.winner === "w" ? magnitude : -magnitude;
}

/** The same number seen from `color`'s side. */
export function evalFor(e: Evaluation, color: Color): number {
  return color === "w" ? evalToNumber(e) : -evalToNumber(e);
}

/**
 * How much worse `after` is than `best` for `mover`, in centipawns, clamped so a
 * missed mate doesn't produce six-digit numbers.
 */
export function evalLoss(best: Evaluation, after: Evaluation, mover: Color): number {
  const clamp = (n: number) => Math.max(-2000, Math.min(2000, n));
  return Math.max(0, clamp(evalFor(best, mover)) - clamp(evalFor(after, mover)));
}

/** "+1.25", "−0.40", "0.00", "#3", "#−3". Mate sign follows the winner (White = +). */
export function formatEval(e: Evaluation): string {
  if (e.kind === "mate") {
    if (e.moves === 0) return e.winner === "w" ? "1-0" : "0-1";
    return e.winner === "w" ? `#${e.moves}` : `#−${e.moves}`;
  }
  const pawns = e.cp / 100;
  if (Math.abs(pawns) < 0.005) return "0.00";
  return (pawns > 0 ? "+" : "−") + Math.abs(pawns).toFixed(2);
}

export type EvalStrength = "equal" | "slight" | "clear" | "winning" | "mate";

export interface EvalVerdict {
  leader: Color | null;
  strength: EvalStrength;
  /** Plain-language headline, e.g. "White is clearly better". */
  headline: string;
}

export function describeEval(e: Evaluation): EvalVerdict {
  const side = (c: Color) => (c === "w" ? "White" : "Black");
  if (e.kind === "mate") {
    if (e.moves === 0) return { leader: e.winner, strength: "mate", headline: `${side(e.winner)} has delivered checkmate` };
    return {
      leader: e.winner,
      strength: "mate",
      headline: `${side(e.winner)} forces mate in ${e.moves}`,
    };
  }
  const abs = Math.abs(e.cp);
  const leader: Color = e.cp > 0 ? "w" : "b";
  if (abs < 35) return { leader: null, strength: "equal", headline: "Roughly equal" };
  if (abs < 100) return { leader, strength: "slight", headline: `${side(leader)} is slightly better` };
  if (abs < 250) return { leader, strength: "clear", headline: `${side(leader)} is clearly better` };
  return { leader, strength: "winning", headline: `${side(leader)} is winning` };
}

/**
 * White's share of the eval bar, 0..1. Uses the logistic win-probability curve
 * popularized by Lichess so that +1 and +6 don't look linear.
 */
export function evalBarShare(e: Evaluation): number {
  if (e.kind === "mate") return e.winner === "w" ? 1 : 0;
  const cp = Math.max(-1500, Math.min(1500, e.cp));
  const win = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return 0.5 + 0.5 * win;
}
