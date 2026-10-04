/**
 * Game accuracy, following Lichess (lichess.org/page/accuracy): per-move accuracy
 * from win% before/after, then per player the average of a volatility-weighted
 * mean and a harmonic mean, so one blunder in a dead-equal game doesn't sink the score.
 */
import type { Color } from "../chess/types";
import type { ClassifiedMove } from "./classify";

function stdDev(xs: number[]) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

export function gameAccuracy(moves: ClassifiedMove[]): Record<Color, number | null> {
  if (!moves.length) return { w: null, b: null };
  // White-relative win% for every position: before the first move, then after each move.
  const wins: number[] = [moves[0].move.color === "w" ? moves[0].before * 100 : (1 - moves[0].before) * 100];
  for (const m of moves) wins.push(m.move.color === "w" ? m.after * 100 : (1 - m.after) * 100);
  const windowSize = Math.max(2, Math.min(8, Math.floor(wins.length / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < Math.max(0, Math.min(windowSize, wins.length) - 2); i++) windows.push(wins.slice(0, windowSize));
  for (let i = 0; i + windowSize <= wins.length; i++) windows.push(wins.slice(i, i + windowSize));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));

  const out: Record<Color, number | null> = { w: null, b: null };
  for (const c of ["w", "b"] as Color[]) {
    const own = moves.map((m, i) => ({ m, w: weights[i] ?? 1 })).filter((x) => x.m.move.color === c);
    if (!own.length) continue;
    const wsum = own.reduce((s, x) => s + x.w, 0);
    const weighted = own.reduce((s, x) => s + x.m.accuracy * x.w, 0) / wsum;
    const harmonic = own.length / own.reduce((s, x) => s + 1 / Math.max(x.m.accuracy, 0.5), 0);
    out[c] = Math.round(((weighted + harmonic) / 2) * 10) / 10;
  }
  return out;
}
