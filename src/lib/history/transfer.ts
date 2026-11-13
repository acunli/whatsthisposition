/**
 * Moving the history between devices: a JSON file the user exports and imports. Nothing
 * is uploaded — the file is the only carrier. The import side is untrusted input: every
 * field is checked, a bad record is skipped rather than failing the whole file, and an
 * import never deletes a game the history already holds.
 */
import { PgnError, parseGame, gamePgn, type ParsedGame } from "../review/pgn";
import { unpackReview } from "../review/share";
import type { MoveClass } from "../review/classify";
import { CLASS_ORDER } from "../review/classify";
import { gameIdOf } from "./record";
import type { HistoryRecord, HistorySummary } from "./types";
import { HISTORY_VERSION } from "./types";

export const HISTORY_APP = "whatsthisposition-history";

/** Refusal limits, generous but firm: a review blob is tens of KB, a game's PGN a few. */
const MAX_FILE_CHARS = 50 * 1024 * 1024;
const MAX_GAMES = 2000;
const MAX_PGN_CHARS = 100 * 1024;
const MAX_DATA_CHARS = 512 * 1024;
const MAX_TEXT = 200;

const cap = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

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
  } catch (e) {
    if (e instanceof PgnError) return null;
    throw e;
  }
  const depth = r.depth;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth <= 0 || depth > 100) return null;
  const as = r.as === "w" || r.as === "b" ? r.as : undefined;
  // The file's own id is ignored: the id comes from the PGN, so the same game from two
  // sources collapses to one record.
  const pgn = gamePgn(game);
  const summary = readSummary(r.summary, game);
  let data: string | undefined;
  if (typeof r.data === "string" && r.data && r.data.length <= MAX_DATA_CHARS) {
    const done = await unpackReview(r.data);
    if (done && done.positions.length === game.moves.length + 1) data = r.data;
  }
  const at = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : now);
  return {
    v: 1,
    id: await gameIdOf(game),
    pgn,
    ...(as ? { as } : {}),
    depth,
    ...(data ? { data } : {}),
    reviewedAt: at(r.reviewedAt),
    lastOpenedAt: at(r.lastOpenedAt),
    summary,
  };
}

/** The summary of an imported record, taken field by field; anything missing or wrong comes from the parsed game. */
function readSummary(value: unknown, game: ParsedGame): HistorySummary {
  const summary: HistorySummary = {
    white: cap(game.white, MAX_TEXT),
    black: cap(game.black, MAX_TEXT),
    ...(game.whiteElo ? { whiteElo: game.whiteElo } : {}),
    ...(game.blackElo ? { blackElo: game.blackElo } : {}),
    result: cap(game.result, 12),
    ...(game.headers.Date ? { playedOn: cap(game.headers.Date, 40) } : {}),
    ...(game.headers.Site ? { site: cap(game.headers.Site, MAX_TEXT) } : {}),
    opening: game.opening ? { eco: "", name: cap(game.opening, MAX_TEXT) } : null,
    plies: game.moves.length,
    accuracy: { w: null, b: null },
    counts: {},
  };
  if (!value || typeof value !== "object") return summary;
  const s = value as Record<string, unknown>;
  const name = (x: unknown) => (typeof x === "string" && x ? cap(x, MAX_TEXT) : undefined);
  const elo = (x: unknown) => (typeof x === "string" && x && x.length <= 12 ? x : undefined);
  summary.white = name(s.white) ?? summary.white;
  summary.black = name(s.black) ?? summary.black;
  const whiteElo = elo(s.whiteElo);
  const blackElo = elo(s.blackElo);
  if (whiteElo) summary.whiteElo = whiteElo;
  if (blackElo) summary.blackElo = blackElo;
  summary.result = name(s.result) ?? summary.result;
  const playedOn = name(s.playedOn);
  const site = name(s.site);
  if (playedOn) summary.playedOn = playedOn;
  if (site) summary.site = site;
  if (s.opening && typeof s.opening === "object") {
    const o = s.opening as Record<string, unknown>;
    const eco = typeof o.eco === "string" && o.eco.length <= 8 ? o.eco : "";
    const open = name(o.name);
    summary.opening = open ? { eco, name: open } : null;
  }
  if (typeof s.plies === "number" && Number.isInteger(s.plies) && s.plies >= 0 && s.plies <= 10_000) summary.plies = s.plies;
  if (s.accuracy && typeof s.accuracy === "object") {
    const a = s.accuracy as Record<string, unknown>;
    const acc = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100 ? x : null);
    summary.accuracy = { w: acc(a.w), b: acc(a.b) };
  }
  if (s.counts && typeof s.counts === "object") {
    const counts: HistorySummary["counts"] = {};
    for (const cls of CLASS_ORDER as MoveClass[]) {
      const c = (s.counts as Record<string, unknown>)[cls];
      if (c && typeof c === "object") {
        const w = (c as Record<string, unknown>).w;
        const b = (c as Record<string, unknown>).b;
        if (typeof w === "number" && Number.isInteger(w) && w >= 0 && typeof b === "number" && Number.isInteger(b) && b >= 0) counts[cls] = { w, b };
      }
    }
    summary.counts = counts;
  }
  return summary;
}

/**
 * Merges an import into what the history already holds: the same game from both sides is
 * kept at the higher depth (a tie goes to the newer review), and nothing that isn't in the
 * file is removed. `changed` lists only the records that have to be written back.
 */
export function mergeImported(existing: HistoryRecord[], imported: HistoryRecord[]): {
  merged: HistoryRecord[];
  changed: HistoryRecord[];
  added: number;
  skipped: number;
} {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const changed: HistoryRecord[] = [];
  let added = 0;
  let skipped = 0;
  for (const rec of imported) {
    const current = byId.get(rec.id);
    const incomingWins =
      !current ||
      rec.depth > current.depth ||
      (rec.depth === current.depth &&
        (rec.data && !current.data ? true : (!rec.data && current.data ? false : rec.reviewedAt > current.reviewedAt)));
    if (incomingWins) {
      byId.set(rec.id, rec);
      changed.push(rec);
      added++;
    } else {
      skipped++;
    }
  }
  return { merged: [...byId.values()], changed, added, skipped };
}
