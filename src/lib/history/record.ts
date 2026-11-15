/**
 * Building a history record from a finished review, and the rules for keeping one game's
 * record up to date. Everything here is pure apart from the id's hashing; the database
 * side of it is in store.ts.
 */
import { START_FEN } from "../chess/fen";
import type { Color } from "../chess/types";
import { tally, type GameReview } from "../review/review";
import { gamePgn, mainLineTokens, readHeaders, type ParsedGame } from "../review/pgn";
import type { HistoryRecord, HistorySummary } from "./types";

/** The first 32 hex characters of the SHA-256 over `text`. Without `crypto.subtle` (a
 * plain-HTTP address on a private network, say) a plain deterministic hash stands in. */
async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
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

/**
 * A game's id: the first 32 hex characters of the SHA-256 over a canonical form of the
 * game — its headers in one order and its clocks left out, so the same game arriving
 * twice from the same source (re-reviewed, imported from another site's export) collapses
 * to one record. Headers are part of it, so two sources that write different paperwork
 * for the same moves get two ids; `substanceKeyOf` is what brings those together.
 */
export async function gameIdOf(game: ParsedGame): Promise<string> {
  const canonical = gamePgn({
    ...game,
    headers: Object.fromEntries(Object.entries(game.headers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    moves: game.moves.map((m) => ({ ...m, clock: undefined })),
  });
  return hashText(canonical);
}

/**
 * A game's substance key: the same hash over what the game *is* rather than how a source
 * wrote it down — the starting position, both player names (trimmed, case aside) and the
 * moves in order. No headers, no date, no result, so the same game read from Chess.com's
 * API and off its page (which writes its own Event, Site, Date and Termination) is one
 * game. The PGN must be in this site's canonical form (`gamePgn`), which every record's
 * is; old records without a stored key are keyed from their PGN when they are matched.
 */
export async function substanceKeyOf(pgn: string): Promise<string> {
  const headers = readHeaders(pgn);
  const startFen = headers.SetUp === "1" && headers.FEN ? headers.FEN : headers.FEN ?? START_FEN;
  const white = (headers.White || "White").trim().toLowerCase();
  const black = (headers.Black || "Black").trim().toLowerCase();
  const { sans } = mainLineTokens(pgn);
  return hashText(`${startFen}\n${white}\n${black}\n${sans.join(" ")}`);
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
    key: await substanceKeyOf(pgn),
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
 * The rule for one game's record, followed here and by the import (transfer.ts): a record
 * with a packed review beats one without, the deeper review beats the shallower (a record's
 * depth is never lowered), and at the same depth the newer review wins — except the very
 * same packed review, which is what opening a game from the history hands back: then only
 * the visit is news. True when `incoming` replaces `existing`.
 */
export function incomingWins(existing: HistoryRecord, incoming: HistoryRecord): boolean {
  if (!!incoming.data !== !!existing.data) return !!incoming.data;
  if (incoming.depth !== existing.depth) return incoming.depth > existing.depth;
  if (existing.data && incoming.data && existing.data === incoming.data) return false;
  return incoming.reviewedAt > existing.reviewedAt;
}

/**
 * Keeps a new review of a game: the review that wins under `incomingWins` replaces what the
 * record held, and otherwise the record stands and only the visit (and the side it is now
 * viewed from) is noted. The record's id never changes — when the same game arrives from
 * another source under another id, the local row keeps the id it was first saved with.
 */
export function upsert(existing: HistoryRecord | null, incoming: HistoryRecord, now: number): HistoryRecord {
  if (!existing) return incoming;
  const key = existing.key ?? incoming.key;
  if (!incomingWins(existing, incoming)) {
    return {
      ...existing,
      ...(key ? { key } : {}),
      ...(incoming.as ? { as: incoming.as } : {}),
      lastOpenedAt: now,
    };
  }
  return {
    ...incoming,
    id: existing.id,
    ...(key ? { key } : {}),
    reviewedAt: now,
    lastOpenedAt: now,
  };
}
