/**
 * Building a history record from a finished review, and the rules for keeping one game's
 * record up to date. Everything here is pure apart from the id's hashing; the database
 * side of it is in store.ts.
 */
import type { Color } from "../chess/types";
import { tally, type GameReview } from "../review/review";
import { gamePgn, type ParsedGame } from "../review/pgn";
import type { HistoryRecord, HistorySummary } from "./types";

/**
 * A game's id: the first 32 hex characters of the SHA-256 over a canonical form of the
 * game — its headers in one order and its clocks left out, so the same game arriving
 * twice (re-reviewed, imported from another site's export) collapses to one record.
 * Without `crypto.subtle` (a plain-HTTP address on a private network, say) a plain
 * deterministic hash stands in.
 */
export async function gameIdOf(game: ParsedGame): Promise<string> {
  const canonical = gamePgn({
    ...game,
    headers: Object.fromEntries(Object.entries(game.headers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    moves: game.moves.map((m) => ({ ...m, clock: undefined })),
  });
  const bytes = new TextEncoder().encode(canonical);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return toHex(new Uint8Array(digest)).slice(0, 32);
  }
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = Math.imul(b + byte, 0x85ebca6b) >>> 0;
  }
  return (toHex32(a) + toHex32(b) + toHex32(Math.imul(a ^ b, 0x27d4eb2f) >>> 0)).slice(0, 32);
}

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const toHex32 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");

/** The facts a history row shows, from the parsed game and its finished review. */
export function summarise(game: ParsedGame, review: GameReview | null, accuracy: { w: number | null; b: number | null }): HistorySummary {
  return {
    white: game.white,
    black: game.black,
    ...(game.whiteElo ? { whiteElo: game.whiteElo } : {}),
    ...(game.blackElo ? { blackElo: game.blackElo } : {}),
    result: game.result,
    ...(game.headers.Date ? { playedOn: game.headers.Date } : {}),
    ...(game.headers.Site ? { site: game.headers.Site } : {}),
    opening: review?.opening ?? (game.opening ? { eco: "", name: game.opening } : null),
    plies: game.moves.length,
    accuracy: { w: accuracy.w, b: accuracy.b },
    counts: review ? (tally(review.moves) as HistorySummary["counts"]) : {},
  };
}

/** A record for the history: the game, its review and when it happened. */
export async function buildRecord(input: {
  game: ParsedGame;
  as?: Color;
  depth: number;
  data?: string;
  review: GameReview;
  accuracy: { w: number | null; b: number | null };
  now: number;
}): Promise<HistoryRecord> {
  const pgn = gamePgn(input.game);
  return {
    v: 1,
    id: await gameIdOf(input.game),
    pgn,
    ...(input.as ? { as: input.as } : {}),
    depth: input.depth,
    ...(input.data ? { data: input.data } : {}),
    reviewedAt: input.now,
    lastOpenedAt: input.now,
    summary: summarise(input.game, input.review, input.accuracy),
  };
}

/**
 * The rules for keeping one game's record: a new review of the same game either replaces
 * the old one (another depth, or the old record had no packed review) or, when nothing has
 * changed but the visit, only the visit is noted. An older review never lowers a record's
 * depth this way.
 */
export function upsert(existing: HistoryRecord | null, incoming: HistoryRecord, now: number): HistoryRecord {
  if (!existing) return incoming;
  const unchanged = existing.depth === incoming.depth && !!existing.data && !!incoming.data;
  if (unchanged) return { ...existing, ...(incoming.as ? { as: incoming.as } : {}), lastOpenedAt: now };
  return { ...incoming, reviewedAt: now, lastOpenedAt: now };
}
