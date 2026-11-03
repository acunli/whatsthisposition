#!/usr/bin/env node
// Builds src/data/opening-lines.json from the Lichess chess-openings dataset (CC0,
// https://github.com/lichess-org/chess-openings): every catalogued line as [eco, name, moves],
// the moves in SAN separated by spaces. The opening pages (/openings) are made from it and the
// master book (src/lib/openings/catalog.ts).
//
// Usage: node scripts/build-opening-lines.mjs   (downloads the five TSV files)
import { writeFileSync } from "node:fs";

const rows = [];
for (const f of ["a", "b", "c", "d", "e"]) {
  const res = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${f}.tsv`);
  if (!res.ok) throw new Error(`download ${f}.tsv failed: ${res.status}`);
  for (const row of (await res.text()).trim().split("\n").slice(1)) {
    const [eco, name, pgn] = row.split("\t");
    rows.push([eco, name, pgn.replace(/\d+\.(\.\.)?/g, " ").trim().split(/\s+/).join(" ")]);
  }
}
writeFileSync("src/data/opening-lines.json", `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`${rows.length} lines → src/data/opening-lines.json`);
