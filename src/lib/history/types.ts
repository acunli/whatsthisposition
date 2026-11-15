/**
 * The history of the games a user reviews, kept in this browser only (see store.ts).
 * These types are the records the database holds and the export file carries; they are
 * versioned on their own (`HISTORY_VERSION`), separate from the packed review's format.
 */
import type { Color } from "../chess/types";
import type { MoveClass } from "../review/classify";

export const HISTORY_VERSION = 1;

/** The facts about the game a row of the history shows, taken from the PGN and the review. */
export interface HistorySummary {
  white: string;
  black: string;
  whiteElo?: string;
  blackElo?: string;
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
  /** The PGN's Date header, as written, if present. */
  playedOn?: string;
  /** The PGN's Site header, if present. */
  site?: string;
  opening?: { eco: string; name: string } | null;
  plies: number;
  accuracy: { w: number | null; b: number | null };
  /** Move-label counts per side, from `tally()`. */
  counts: Partial<Record<MoveClass, { w: number; b: number }>>;
}

/** One reviewed game in the history. */
export interface HistoryRecord {
  v: 1;
  /** First 32 hex chars of the SHA-256 over the game's normalised PGN (see record.ts). */
  id: string;
  /** The game's normalised PGN (`gamePgn(parseGame(pgn))`). */
  pgn: string;
  /** The side the user viewed the game from. */
  as?: Color;
  /** The search depth the review was done at. */
  depth: number;
  /** The finished review, packed (`packReview`); absent means the review runs again on open. */
  data?: string;
  /** When this review was made or last replaced. */
  reviewedAt: number;
  /** When the game was last reviewed or opened from the history. */
  lastOpenedAt: number;
  summary: HistorySummary;
}
