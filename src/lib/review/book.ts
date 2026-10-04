/**
 * Opening book built from the Lichess chess-openings dataset (CC0) by
 * scripts/build-openings.mjs. Positions are keyed by a hash of piece placement +
 * side to move, so transpositions are recognised.
 */

/** cyrb53 hash, base36; must match scripts/build-openings.mjs. */
export function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const bookKey = (fen: string) => hash(fen.split(" ").slice(0, 2).join(" "));

export interface OpeningBook {
  inBook(fen: string): boolean;
  name(fen: string): { eco: string; name: string } | null;
}

interface BookData {
  book: string[];
  names: Record<string, string>;
}

export function makeBook(data: BookData): OpeningBook {
  const set = new Set(data.book);
  return {
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

/** Lazily loads the book (about 120 KB gzipped) the first time a game is reviewed. */
export function loadBook(): Promise<OpeningBook> {
  if (!cached) cached = import("@/data/openings.json").then((m) => makeBook((m.default ?? m) as BookData));
  return cached;
}
