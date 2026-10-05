/** Position keys shared by the named book, the master book and their build scripts. */

/** cyrb53 hash as a 53-bit number; must match scripts/build-openings.mjs and scripts/build-book.mjs. */
export function hash53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The same hash in base 36, as the named book stores it. */
export const hash = (str: string) => hash53(str).toString(36);

export const bookKey = (fen: string) => hash(fen.split(" ").slice(0, 2).join(" "));
