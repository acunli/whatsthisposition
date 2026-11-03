import "server-only";

/**
 * The opening pages' catalog (src/lib/openings/catalog.ts), made once when the site is built
 * (the pages are static) from the catalogued lines and the master book in public/data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import lines from "@/data/opening-lines.json";
import { buildCatalog, type Catalog, type OpeningLine } from "../openings/catalog";
import { parseMasters } from "../review/masters";

let catalog: Catalog | null = null;

export function openingCatalog(): Catalog {
  if (catalog) return catalog;
  const buf = gunzipSync(readFileSync(join(process.cwd(), "public/data/masters-book.bin.gz")));
  const book = parseMasters(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  catalog = buildCatalog(lines as OpeningLine[], book);
  return catalog;
}
