/**
 * A finished game as the browser extension's review card takes it, from either site it runs on
 * (Chess.com: chesscomGame.ts and chesscomPage.ts; Lichess: lichessGame.ts).
 */
import type { Color } from "../chess/types";

export interface FinishedGame {
  pgn: string;
  white: string;
  black: string;
  /** "1-0", "0-1" or "1/2-1/2". */
  result: string;
  /** "Ay7u won by checkmate" and the like. */
  message: string;
  /** The colour shown at the bottom of the board (on your own game: yours). */
  bottom: Color;
  url: string;
  /** When the game ended (ms since the epoch), if the site says. */
  endedAt: number | null;
  /** How many moves (plies) were played. */
  plies: number;
}
