/**
 * Moving the history between devices: a JSON file the user exports and imports. Nothing
 * is uploaded — the file is the only carrier. The import side is untrusted input: every
 * field is checked, a bad record is skipped rather than failing the whole file, and an
 * import never deletes a game the history already holds.
 */
import { gamePgn, parseGame, type ParsedGame } from "../review/pgn";
import { unpackReview } from "../review/share";
import { loadBook } from "../review/book";
import { classifyGame } from "../review/review";
import { gameAccuracy } from "../review/accuracy";
import { gameIdOf, incomingWins, substanceKeyOf, summarise } from "./record";
import type { HistoryRecord } from "./types";
import { HISTORY_VERSION } from "./types";

export const HISTORY_APP = "whatsthisposition-history";

/** Refusal limits, generous but firm: a review blob is tens of KB, a game's PGN a few. */
const MAX_FILE_CHARS = 50 * 1024 * 1024;
const MAX_GAMES = 2000;
const MAX_PGN_CHARS = 100 * 1024;
const MAX_DATA_CHARS = 512 * 1024;

/** The export file's name: whatsthisposition-history-2026-11-13.json. */
export function exportFileName(exportedAt: number): string {
  const d = new Date(exportedAt);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `whatsthisposition-history-${day}.json`;
}

/** The export file's text: every record in the history. */
export function exportFile(records: HistoryRecord[], exportedAt = Date.now()): string {
  return JSON.stringify({ app: HISTORY_APP, version: HISTORY_VERSION, exportedAt, games: records });
}

export type ImportResult =
  | { ok: true; records: HistoryRecord[]; kept: number; rejected: number }
  | { ok: false; reason: "too-large" | "not-history" | "newer-version" | "unreadable" };

/**
 * Reads an export file's text. Records that are wrong are skipped (counted in `rejected`);
 * a record whose packed review is unreadable keeps its game and drops the review (opening
 * it will run the engine again). Never throws.
 */
export async function parseImport(text: string, now = Date.now()): Promise<ImportResult> {
  if (text.length > MAX_FILE_CHARS) return { ok: false, reason: "too-large" };
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!file || typeof file !== "object") return { ok: false, reason: "unreadable" };
  const f = file as Record<string, unknown>;
  if (f.app !== HISTORY_APP) return { ok: false, reason: "not-history" };
  const version = f.version;
  if (typeof version !== "number" || version !== HISTORY_VERSION) {
    return { ok: false, reason: typeof version === "number" && version > HISTORY_VERSION ? "newer-version" : "not-history" };
  }
  if (!Array.isArray(f.games)) return { ok: false, reason: "not-history" };
  if (f.games.length > MAX_GAMES) return { ok: false, reason: "too-large" };
  const records: HistoryRecord[] = [];
  let rejected = 0;
  for (const entry of f.games) {
    const rec = await readRecord(entry, now);
    if (rec) records.push(rec);
    else rejected++;
  }
  return { ok: true, records, kept: records.length, rejected };
}

/** One entry of an import file, checked field by field, or null (skip it). */
async function readRecord(value: unknown, now: number): Promise<HistoryRecord | null> {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.v !== HISTORY_VERSION) return null;
  if (typeof r.pgn !== "string" || !r.pgn || r.pgn.length > MAX_PGN_CHARS) return null;
  let game: ParsedGame;
  try {
    game = parseGame(r.pgn);
  } catch {
    // Whatever threw, a record whose PGN won't parse is skipped, never the whole file.
    return null;
  }
  const depth = r.depth;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth <= 0 || depth > 100) return null;
  const as = r.as === "w" || r.as === "b" ? r.as : undefined;
  // The file's own id is ignored: the id comes from the PGN, so the same game from two
  // sources collapses to one record.
  const pgn = gamePgn(game);
  // The file's `summary` is never read: a hand-edited file can say any result or accuracy.
  // The facts come from the PGN, and the numbers from the packed review, classified again
  // exactly as the review page would. Without a packed review there are no numbers to show.
  let data: string | undefined;
  let summary = summarise(game, null, { w: null, b: null });
  if (typeof r.data === "string" && r.data && r.data.length <= MAX_DATA_CHARS) {
    const done = await unpackReview(r.data);
    if (done && done.positions.length === game.moves.length + 1) {
      data = r.data;
      const book = await loadBook().catch(() => null);
      const review = classifyGame(game, done.positions, book);
      summary = summarise(game, review, gameAccuracy(review.moves));
    }
  }
  const at = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : now);
  return {
    v: 1,
    id: await gameIdOf(game),
    key: await substanceKeyOf(pgn),
    pgn,
    ...(as ? { as } : {}),
    depth,
    ...(data ? { data } : {}),
    reviewedAt: at(r.reviewedAt),
    lastOpenedAt: at(r.lastOpenedAt),
    summary,
  };
}

/**
 * Merges an import into what the history already holds. The same game is recognised by its
 * id or, when the two sources wrote different headers, by its substance key (record.ts);
 * which of the two reviews is kept is that file's one rule (`incomingWins`), and nothing
 * that isn't in the file is removed. `changed` lists only the records that have to be
 * written back, and a record keeps the id it already had here.
 */
export async function mergeImported(
  existing: HistoryRecord[],
  imported: HistoryRecord[],
): Promise<{
  merged: HistoryRecord[];
  changed: HistoryRecord[];
  added: number;
  skipped: number;
}> {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const byKey = new Map<string, HistoryRecord>();
  for (const rec of existing) byKey.set(rec.key ?? (await substanceKeyOf(rec.pgn)), rec);
  const changed: HistoryRecord[] = [];
  let added = 0;
  let skipped = 0;
  for (const rec of imported) {
    const key = rec.key ?? (await substanceKeyOf(rec.pgn));
    const current = byId.get(rec.id) ?? byKey.get(key) ?? null;
    if (!current || incomingWins(current, rec)) {
      const kept = current ? { ...rec, id: current.id } : rec;
      byId.set(kept.id, kept);
      byKey.set(key, kept);
      changed.push(kept);
      added++;
    } else {
      skipped++;
    }
  }
  return { merged: [...byId.values()], changed, added, skipped };
}
