/**
 * Game accuracy on Chess.com's scale.
 *
 * Per move: Lichess's accuracy-from-win% formula, 103.17·e^(−a·Δwin%) − 3.17, with a
 * steeper decay (a = 0.07). Per player: the plain average over their moves (forced
 * moves left out), mapped linearly onto Chess.com's scale.
 *
 * The decay and the mapping were fitted on 46 Chess.com-reviewed games from the
 * owner's test account (Ay7u), reviewed here at depth 14. Against Chess.com's own
 * numbers this gives a mean error of about 3.5 points on held-out games, against
 * 7.5 for Lichess's volatility-weighted aggregation (correlation 0.89 vs 0.66).
 * See docs/position-understanding.md, "Accuracy".
 */
import type { Color } from "../chess/types";
import type { ClassifiedMove } from "./classify";

export const ACCURACY_DECAY = 0.07;
export const ACCURACY_SCALE = { slope: 1.444, offset: -43.3 };

/** Accuracy of one move (0–100) from the mover's win% before and after it. */
export function moveAccuracyFor(winBefore: number, winAfter: number, decay = ACCURACY_DECAY): number {
  const a = 103.1668 * Math.exp(-decay * Math.max(0, winBefore - winAfter)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

export function gameAccuracy(moves: ClassifiedMove[]): Record<Color, number | null> {
  const out: Record<Color, number | null> = { w: null, b: null };
  for (const c of ["w", "b"] as Color[]) {
    const own = moves.filter((m) => m.move.color === c && m.cls !== "forced");
    if (!own.length) continue;
    const mean = own.reduce((s, m) => s + moveAccuracyFor(m.before * 100, m.after * 100), 0) / own.length;
    const scaled = ACCURACY_SCALE.slope * mean + ACCURACY_SCALE.offset;
    out[c] = Math.round(Math.max(0, Math.min(100, scaled)) * 10) / 10;
  }
  return out;
}
