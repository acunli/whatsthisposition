/**
 * Opening book: names from the Lichess chess-openings dataset (CC0, built by
 * scripts/build-openings.mjs), plus the master book (src/lib/review/masters.ts) for
 * how deep theory goes and what strong players play. Positions are keyed by a hash
 * of piece placement + side to move, so transpositions are recognised.
 */
import { bookKey } from "./positionKey";
import { loadMasters, type MastersBook } from "./masters";


export { bookKey, hash, hash53 } from "./positionKey";

export interface OpeningBook {
  /** The position is on a named opening line. */
  inBook(fen: string): boolean;
  name(fen: string): { eco: string; name: string } | null;
  /** What masters played, when the master book loaded. */
  masters?: MastersBook | null;
}

interface BookData {
  book: string[];
  names: Record<string, string>;
}

export function makeBook(data: BookData, masters: MastersBook | null = null): OpeningBook {
  const set = new Set(data.book);
  return {
    masters,
    inBook: (fen) => set.has(bookKey(fen)),
    name: (fen) => {
      const v = data.names[bookKey(fen)];
      if (!v) return null;
      const [eco, ...rest] = v.split("|");
      return { eco, name: rest.join("|") };
    },
  };
}

let cached: Promise<OpeningBook> | null = null;

/**
 * Lazily loads the book the first time a game is reviewed: the names (about 120 KB
 * gzipped) and the master book. Without the master book, theory is the named lines only.
 */
export function loadBook(): Promise<OpeningBook> {
  if (!cached)
    cached = Promise.all([import("@/data/openings.json"), loadMasters().catch(() => null)]).then(([m, masters]) =>
      makeBook((m.default ?? m) as BookData, masters),
    );
  return cached;
}
