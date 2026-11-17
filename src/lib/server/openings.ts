import "server-only";

/**
 * The opening pages' catalog (src/lib/openings/catalog.ts), made once when the site is built
 * (the pages are static) from the catalogued lines and the master book in public/data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import lines from "@/data/opening-lines.json";
import { buildCatalog, openingSlug, type Catalog, type Opening, type OpeningLine } from "../openings/catalog";
import { parseMasters } from "../review/masters";

let catalog: Catalog | null = null;

export function openingCatalog(): Catalog {
  if (catalog) return catalog;
  const buf = gunzipSync(readFileSync(join(process.cwd(), "public/data/masters-book.bin.gz")));
  const book = parseMasters(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  catalog = buildCatalog(lines as OpeningLine[], book);
  return catalog;
}

/**
 * The opening page for a game's opening (a name from the same Lichess list): its own page, else
 * the nearest line it branches from that has one ("Sicilian Defense: Najdorf Variation, English
 * Attack, Anti-English" → "…, English Attack" → "Sicilian Defense: Najdorf Variation" → "Sicilian
 * Defense"). Null when none has a page.
 */
export function openingPageFor(name: string | null | undefined): Opening | null {
  const cat = openingCatalog();
  let n = name?.trim() ?? "";
  while (n) {
    const o = cat.bySlug.get(openingSlug(n));
    if (o && o.name === n) return o;
    n = n.includes(",") ? n.slice(0, n.lastIndexOf(",")).trim() : n.includes(":") ? n.slice(0, n.indexOf(":")).trim() : "";
  }
  return null;
}

/** Whether a game's opening is this opening or one of the lines that branch from it. */
export const inOpening = (game: string | null | undefined, o: Opening) => !!game && (game === o.name || game.startsWith(`${o.name}:`) || game.startsWith(`${o.name},`));

