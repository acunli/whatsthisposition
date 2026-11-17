/**
 * How accurate Chess.com players are at each rating, from games Chess.com reviewed: its own
 * accuracy numbers, read from its public API (both players' accuracies and ratings, the time
 * class and the result). scripts/eval/accuracy-by-rating.py writes the aggregates to
 * src/data/accuracy-by-rating.json: per time class and rating band, percentiles 5 to 95 of the
 * players' game accuracy and the medians in games they won and lost. Nothing about a player or a
 * game is kept. The /chess-accuracy page and its questions are built from these numbers, so they
 * stay true when the data is refreshed.
 */
import data from "@/data/accuracy-by-rating.json";

export type AccuracyClass = "rapid" | "blitz" | "bullet";
export const ACCURACY_CLASSES: AccuracyClass[] = ["rapid", "blitz", "bullet"];
export const CLASS_NAME: Record<AccuracyClass, string> = { rapid: "Rapid", blitz: "Blitz", bullet: "Bullet" };

export interface RatingBand {
  /** Ratings from `from` up to (not including) `to`; `to` is null for the top band. */
  from: number;
  to: number | null;
  /** Player-games in the band (each game counts once for each player). */
  n: number;
  /** Accuracy at the percentiles in `ACCURACY_DATA.percentiles` (5, 10 … 95). */
  p: number[];
  /** Median accuracy in the games the player won, and lost (null with too few). */
  won: number | null;
  lost: number | null;
}

export const ACCURACY_DATA = data as {
  games: number;
  updated: string;
  minGames: number;
  percentiles: number[];
  classes: Record<AccuracyClass, RatingBand[]>;
};

/** Accuracy at percentile `pct` (one of 5, 10 … 95) of a band. */
export const at = (b: RatingBand, pct: number) => b.p[ACCURACY_DATA.percentiles.indexOf(pct)];
export const medianOf = (b: RatingBand) => at(b, 50);

export const bandsOf = (tc: AccuracyClass) => ACCURACY_DATA.classes[tc];

/** "under 400", "1000–1199", "2800+". */
export function bandLabel(b: RatingBand): string {
  if (b.to === null) return `${b.from}+`;
  if (b.from === 0) return `under ${b.to}`;
  return `${b.from}–${b.to - 1}`;
}

/** The band a rating falls in, or null when the data has too few games at that rating. */
export function bandFor(tc: AccuracyClass, rating: number): RatingBand | null {
  return bandsOf(tc).find((b) => rating >= b.from && (b.to === null || rating < b.to)) ?? null;
}

/**
 * The share of a band's games played less accurately than `accuracy`, in percent, read between
 * the stored percentiles. Below the 5th or above the 95th it says only that (`edge`).
 */
export function percentileIn(b: RatingBand, accuracy: number): { pct: number; edge: "below" | "above" | null } {
  const ps = ACCURACY_DATA.percentiles;
  if (accuracy <= b.p[0]) return { pct: ps[0], edge: "below" };
  if (accuracy >= b.p[b.p.length - 1]) return { pct: ps[ps.length - 1], edge: "above" };
  for (let i = 1; i < b.p.length; i++) {
    if (accuracy <= b.p[i]) {
      const span = b.p[i] - b.p[i - 1];
      const f = span > 0 ? (accuracy - b.p[i - 1]) / span : 0.5;
      return { pct: Math.round(ps[i - 1] + f * (ps[i] - ps[i - 1])), edge: null };
    }
  }
  return { pct: ps[ps.length - 1], edge: "above" };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const one = (x: number) => x.toFixed(1);

/** The band holding `rating` in a time class, else the nearest one below it. */
function near(tc: AccuracyClass, rating: number): RatingBand {
  const bands = bandsOf(tc);
  return bandFor(tc, rating) ?? [...bands].reverse().find((b) => b.from <= rating) ?? bands[0];
}

/** Sentences for the page's questions, from the numbers. */
export const ACCURACY_TEXT = (() => {
  const rapid = (r: number) => near("rapid", r);
  const steps = [500, 1100, 1700, 2300].map(rapid);
  const top = (["blitz", "bullet"] as const).map((tc) => ({ tc, b: bandsOf(tc).at(-1)! })).filter((x) => x.b.to === null);
  const mid = rapid(1100);
  const club = (["rapid", "blitz"] as const).map((tc) => ({ tc, b: near(tc, 1500) }));
  return {
    games: fmt(ACCURACY_DATA.games),
    good:
      `It depends on your rating and the time control. In rapid, half of the games of players rated ${steps.map((b) => `${bandLabel(b)} reach ${one(medianOf(b))}`).join(", ")} ` +
      `(Chess.com's own accuracy, from ${fmt(ACCURACY_DATA.games)} games it reviewed). A game above the median for your rating is a good one; the top quarter starts around ${one(at(mid, 75))} at ${bandLabel(mid)}.`,
    club:
      `Players rated ${bandLabel(club[0].b)} have a median accuracy of ${one(medianOf(club[0].b))} in rapid (the middle half of their games between ${one(at(club[0].b, 25))} and ${one(at(club[0].b, 75))}) ` +
      `and ${one(medianOf(club[1].b))} in blitz.`,
    top: top.length
      ? `The best online players (rated 2800 and above on Chess.com) have a median accuracy of ${top.map(({ tc, b }) => `${one(medianOf(b))} in ${tc}`).join(" and ")}, ` +
        `and the middle half of their ${top[0].tc} games fall between ${one(at(top[0].b, 25))} and ${one(at(top[0].b, 75))}. Even they rarely play a whole game near 100.`
      : "",
    lost:
      `Accuracy measures your moves, not the result. At ${bandLabel(mid)} in rapid, players' median accuracy is ${one(mid.won!)} in the games they win and ${one(mid.lost!)} in the games they lose, ` +
      `but the ranges overlap a lot: one blunder at the wrong moment decides a game, your opponent may have played better still, and a short or quiet game scores higher than a long fight.`,
  };
})();
