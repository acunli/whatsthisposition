/**
 * Performance rating: how well each side played this one game, in rating points.
 *
 * Chess.com describes its own number as "comparing the quality of your moves to what is
 * expected from a player at your rating level", and says it averages out to the player's
 * rating over time. This does the same with the game's accuracy:
 *
 *   level       = the rating whose usual accuracy equals this game's accuracy
 *   performance = rating + WEIGHT × (level − rating)
 *
 * so a game played exactly as accurately as that rating usually plays gives the rating
 * back, and a better or worse game moves away from it. One game says only so much about
 * a player, which is why it counts for WEIGHT and not in full.
 *
 * The usual accuracy at each rating (EXPECTED) was fitted on 36,600 rated games that
 * Chess.com reviewed (its public API gives both accuracies, both ratings and the time
 * class): players of every level sampled from the country lists, plus top players' blitz
 * and bullet games. Accuracy rises fast up to about 650 and steadily after that, so the
 * curve is two straight pieces. scripts/eval/fit-performance.py refits it.
 *
 * The weight is a judgement, not a measurement. On those games the performance gap
 * between the two players predicts the result best at about 0.5, and nearly as well from
 * 0.4; at 0.35 the middle half of games land between roughly 200 below and 300 above the
 * player's rating, which is the kind of swing Chess.com's own number shows.
 *
 * It is an estimate from accuracy alone, and accuracy depends on the game as well as the
 * player: a short game or a quiet one scores higher than a long fight.
 */
import type { Color } from "../chess/types";
import type { ClassifiedMove } from "./classify";
import type { ParsedGame } from "./pgn";

export type TimeClass = "bullet" | "blitz" | "rapid" | "daily";

/** Expected accuracy = base + below × min(rating, knee) + above × max(0, rating − knee). */
const EXPECTED: Record<Exclude<TimeClass, "daily">, { knee: number; base: number; below: number; above: number }> = {
  rapid: { knee: 650, base: 53.0, below: 0.02404, above: 0.00785 },
  blitz: { knee: 550, base: 55.67, below: 0.02327, above: 0.00659 },
  bullet: { knee: 750, base: 56.05, below: 0.01932, above: 0.00444 },
};
/** Daily games: too few reviewed ones to fit a curve of their own; on those there are, accuracy runs this far above rapid's. */
const DAILY_OVER_RAPID = 1.3;

export const PERFORMANCE_WEIGHT = 0.35;
/** The level is read off a curve that is nearly flat at the top, so it is kept inside the ratings that exist. */
const LEVEL_RANGE: [number, number] = [0, 3600];
const SHOWN_RANGE: [number, number] = [100, 3300];
/** Fewer scored moves than this and the accuracy says too little. */
export const MIN_PERFORMANCE_MOVES = 8;

const curveOf = (tc: TimeClass) => EXPECTED[tc === "daily" ? "rapid" : tc];
const clamp = (x: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, x));

/** The accuracy players of this rating usually reach in this kind of game. */
export function expectedAccuracy(rating: number, tc: TimeClass): number {
  const c = curveOf(tc);
  return c.base + c.below * Math.min(rating, c.knee) + c.above * Math.max(0, rating - c.knee) + (tc === "daily" ? DAILY_OVER_RAPID : 0);
}

/** The rating whose usual accuracy is this one: the curve read backwards. */
export function accuracyLevel(accuracy: number, tc: TimeClass): number {
  const c = curveOf(tc);
  const a = accuracy - (tc === "daily" ? DAILY_OVER_RAPID : 0);
  const atKnee = c.base + c.below * c.knee;
  return clamp(a <= atKnee ? (a - c.base) / c.below : c.knee + (a - atKnee) / c.above, LEVEL_RANGE);
}

/**
 * The game's time class, the way Chess.com sorts them: from the TimeControl header
 * ("600", "180+2", "1/86400"), counting an increment as 40 moves' worth. Unknown: rapid.
 */
export function timeClassOf(headers: Record<string, string>): TimeClass {
  const tc = headers.TimeControl ?? "";
  if (/^\d+\/\d+/.test(tc)) return "daily";
  const m = tc.match(/^(\d+)(?:\+(\d+))?/);
  if (!m) return /correspondence|daily/i.test(headers.Event ?? "") ? "daily" : "rapid";
  const seconds = Number(m[1]) + 40 * Number(m[2] ?? 0);
  return seconds < 180 ? "bullet" : seconds < 600 ? "blitz" : "rapid";
}

/**
 * Lichess ratings run higher than Chess.com's for the same player, by about 200 points at
 * club level and less towards the top (the two pools meet near 2500). The curves here are
 * on Chess.com's scale, so a Lichess game's level is moved onto Lichess's before it is
 * compared with a Lichess rating. Approximate; with the weight it shifts the result by at
 * most 70 points.
 */
function poolShift(headers: Record<string, string>, level: number): number {
  const lichess = /lichess\.org/i.test(`${headers.Site ?? ""} ${headers.Link ?? ""} ${headers.GameUrl ?? ""}`);
  if (!lichess) return 0;
  return level <= 1500 ? 200 : level >= 2500 ? 0 : (200 * (2500 - level)) / 1000;
}

const rated = (elo?: string) => {
  const n = Number(elo);
  return Number.isFinite(n) && n >= 100 && n <= 4000 ? n : null;
};

export interface PerformanceInput {
  accuracy: Record<Color, number | null>;
  /** How many of each side's moves went into its accuracy. */
  scored: Record<Color, number>;
  whiteElo?: string;
  blackElo?: string;
  headers: Record<string, string>;
}

/**
 * Each side's performance rating, rounded to 50, or null when there is too little to go on.
 * A side without a rating is compared with its opponent's; when neither has one, with the
 * level of the game itself (the two levels' average).
 */
export function performanceRatings(inp: PerformanceInput): Record<Color, number | null> {
  const tc = timeClassOf(inp.headers);
  const out: Record<Color, number | null> = { w: null, b: null };
  const level = (c: Color) => {
    const a = inp.accuracy[c];
    if (a == null || inp.scored[c] < MIN_PERFORMANCE_MOVES) return null;
    const l = accuracyLevel(a, tc);
    return l + poolShift(inp.headers, l);
  };
  const levels: Record<Color, number | null> = { w: level("w"), b: level("b") };
  const ratings: Record<Color, number | null> = { w: rated(inp.whiteElo), b: rated(inp.blackElo) };
  const both = levels.w != null && levels.b != null ? (levels.w + levels.b) / 2 : null;
  for (const c of ["w", "b"] as Color[]) {
    const l = levels[c];
    if (l == null) continue;
    const anchor = ratings[c] ?? ratings[c === "w" ? "b" : "w"] ?? both ?? l;
    out[c] = Math.round(clamp(anchor + PERFORMANCE_WEIGHT * (l - anchor), SHOWN_RANGE) / 50) * 50;
  }
  return out;
}

/** The performance ratings of a reviewed game (forced moves don't count towards accuracy, so they don't count here). */
export function gamePerformance(game: ParsedGame, moves: ClassifiedMove[], accuracy: Record<Color, number | null>): Record<Color, number | null> {
  const scored = (c: Color) => moves.filter((m) => m.move.color === c && m.cls !== "forced").length;
  return performanceRatings({ accuracy, scored: { w: scored("w"), b: scored("b") }, whiteElo: game.whiteElo, blackElo: game.blackElo, headers: game.headers });
}
