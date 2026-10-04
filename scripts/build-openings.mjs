#!/usr/bin/env node
// Builds src/data/openings.json from the Lichess chess-openings dataset (CC0,
// https://github.com/lichess-org/chess-openings). Every position reached along a
// catalogued opening line counts as "book"; the final position of each line also
// carries its ECO code and name.
//
// Usage: node scripts/build-openings.mjs   (downloads the five TSV files)
import { writeFileSync, mkdirSync } from "node:fs";
import { Chess } from "chess.js";

/** cyrb53: a fast 53-bit string hash, written as base36 to keep keys short. */
export function hash(str) {
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

/** Book key: piece placement + side to move (castling/en passant ignored, as books usually do). */
export const bookKey = (fen) => hash(fen.split(" ").slice(0, 2).join(" "));

const files = ["a", "b", "c", "d", "e"];
const book = new Set();
const names = {};
let lines = 0;
for (const f of files) {
  const res = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${f}.tsv`);
  if (!res.ok) throw new Error(`download ${f}.tsv failed: ${res.status}`);
  const rows = (await res.text()).trim().split("\n").slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split("\t");
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, " ").trim().split(/\s+/);
    try {
      for (const san of sans) {
        chess.move(san);
        book.add(bookKey(chess.fen()));
      }
    } catch {
      continue;
    }
    const k = bookKey(chess.fen());
    // Keep the most specific (longest) name when several lines transpose.
    if (!names[k] || names[k].length < `${eco}|${name}`.length) names[k] = `${eco}|${name}`;
    lines++;
  }
}

mkdirSync("src/data", { recursive: true });
const out = { source: "lichess-org/chess-openings (CC0)", book: [...book].sort(), names };
writeFileSync("src/data/openings.json", JSON.stringify(out));
console.log(`openings: ${lines} lines, ${book.size} book positions, ${Object.keys(names).length} named`);
