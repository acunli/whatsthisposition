/**
 * A Chess.com game read off its own page, for the browser extension. Chess.com's move list
 * (`wc-simple-move-list`) has one `.node` per move while a game is played and shows the
 * result (`.game-result`, "1-0") once it's over; watching it tells a game that ends in front
 * of you from one opened already finished. The page itself is read in
 * extension/src/content.ts; what's here works on plain data, so it can be tested.
 */
import { Chess } from "chess.js";
import type { Color } from "../chess/types";
import type { ChessComGame } from "./chesscomGame";

export type GameResult = "1-0" | "0-1" | "1/2-1/2";

/** "1-0", "0-1" or a draw, as Chess.com writes it under the moves; anything else isn't a result. */
export function readResult(text: string | null | undefined): GameResult | null {
  const t = (text ?? "").replace(/\s+/g, "");
  if (t === "1-0" || t === "0-1") return t;
  if (t === "½-½" || t === "1/2-1/2") return "1/2-1/2";
  return null;
}

const PIECE_WORDS: Record<string, string> = { king: "K", queen: "Q", rook: "R", bishop: "B", knight: "N" };
const FIGURINES: Record<string, string> = { "♔": "K", "♕": "Q", "♖": "R", "♗": "B", "♘": "N", "♚": "K", "♛": "Q", "♜": "R", "♝": "B", "♞": "N" };

/**
 * The piece letter of a figurine in the move list, or "". With figurine notation Chess.com
 * draws the piece as an icon: `<span class="icon-font-chess knight-white" data-figurine="N">`.
 */
export function figurineLetter(attr: string | null | undefined, className = ""): string {
  if (attr && /^[KQRBN]$/.test(attr)) return attr;
  const m = /\b(king|queen|rook|bishop|knight)-(?:white|black)\b/.exec(className);
  return m ? PIECE_WORDS[m[1]] : "";
}

/** One move as the list shows it ("Nf3 ", "♘f3", "0-0", "e8=Q+") in plain SAN. */
export function cleanSan(raw: string): string {
  return raw
    .replace(/[♔-♟]/g, (c) => FIGURINES[c] ?? "")
    .replace(/0/g, "O")
    .replace(/[^KQRBNa-hO1-8x=+#-]/g, "");
}

export interface PagePlayer {
  name: string | null;
  rating: number | null;
}

export interface PageGame {
  sans: string[];
  result: GameResult;
  white: PagePlayer;
  black: PagePlayer;
  /** The colour at the bottom of the board. */
  bottom: Color;
  /** How it ended, as the result box words it ("by resignation"), if it shows. */
  how?: string | null;
  /** The game's id, if the page names it. */
  ref?: { id: number; kind: "live" | "daily" } | null;
  url: string;
}

const pgnDate = (d: Date) => `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;

/** The game as the extension's card takes it, or null if the moves don't make a legal game. */
export function gameFromPage(p: PageGame, now = Date.now()): ChessComGame | null {
  if (!p.sans.length) return null;
  const chess = new Chess();
  try {
    for (const san of p.sans) chess.move(cleanSan(san));
  } catch {
    return null;
  }
  const white = p.white.name || "White";
  const black = p.black.name || "Black";
  const how = p.how?.replace(/\s+/g, " ").trim() ?? "";
  const winner = p.result === "1-0" ? white : p.result === "0-1" ? black : null;
  const message = `${winner ? `${winner} won` : "Draw"}${how ? ` ${how}` : ""}`;
  const url = p.ref ? `https://www.chess.com/game/${p.ref.kind}/${p.ref.id}` : p.url;
  chess.setHeader("Event", p.ref?.kind === "daily" ? "Daily Chess" : p.ref ? "Live Chess" : "Chess.com game");
  chess.setHeader("Site", "Chess.com");
  chess.setHeader("Date", pgnDate(new Date(now)));
  chess.setHeader("White", white);
  chess.setHeader("Black", black);
  chess.setHeader("Result", p.result);
  if (p.white.rating) chess.setHeader("WhiteElo", String(p.white.rating));
  if (p.black.rating) chess.setHeader("BlackElo", String(p.black.rating));
  chess.setHeader("Termination", message);
  chess.setHeader("Link", url);
  return {
    id: p.ref?.id ?? 0,
    kind: p.ref?.kind ?? "live",
    pgn: chess.pgn(),
    white,
    black,
    result: p.result,
    message,
    bottom: p.bottom,
    url,
    endedAt: now,
    plies: chess.history().length,
  };
}

export interface MoveListSighting {
  plies: number;
  result: GameResult | null;
}

/** How long a move list must show a game without a result before it counts as one being played. */
export const LIVE_AFTER_MS = 8000;

/**
 * Follows the move list through a game. A game counts as being played ("live") once a move is
 * seen being added to it, or once it has shown no result for a while; a game opened already
 * finished (all its moves and the result arrive together) never does. `see` says "ended" at the
 * moment a live game shows its result, and "new" when another game starts in the same list.
 */
export class MoveListWatch {
  live = false;
  result: GameResult | null = null;
  /** A live game's result appeared while watching. */
  ended = false;
  private last: MoveListSighting | null = null;
  private openSince: number | null = null;

  /** `s` is null while no move list shows (another sidebar tab, say): that changes nothing. */
  see(s: MoveListSighting | null, now: number): "new" | "ended" | null {
    if (!s) return null;
    const last = this.last;
    this.last = s;
    if (!last) {
      this.result = s.result;
      this.openSince = s.result ? null : now;
      return null;
    }
    if ((last.result && !s.result) || (!s.result && s.plies < last.plies)) {
      // The result went away or the moves were cleared: another game.
      this.live = false;
      this.ended = false;
      this.result = null;
      this.openSince = now;
      return "new";
    }
    if (!s.result) {
      // One or two moves at a time is a game being played; a jump from nothing is one being loaded.
      if (s.plies > last.plies && (last.plies > 0 || s.plies <= 2)) this.live = true;
      if (now - (this.openSince ?? now) >= LIVE_AFTER_MS) this.live = true;
      return null;
    }
    if (last.result) return null;
    this.result = s.result;
    this.openSince = null;
    // The game that was being played ends (a burst of premoves, or a tab the browser slowed
    // down, can add several moves at once); a whole game arriving on an empty board, or a
    // shorter one replacing it, was opened, not played here.
    if (this.live && s.plies >= last.plies && (last.plies > 0 || s.plies <= 2)) {
      this.ended = true;
      return "ended";
    }
    this.live = false;
    return null;
  }
}
