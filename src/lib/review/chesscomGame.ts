/**
 * One Chess.com game from the JSON its own game page loads
 * (`/callback/live/game/{id}`, `/callback/daily/game/{id}`), turned into a PGN.
 * The browser extension reads it from the Chess.com tab the moment a game ends;
 * the moves come in Chess.com's compact "TCN" encoding, two characters a move.
 */
import { Chess } from "chess.js";
import { START_FEN } from "../chess/fen";
import type { Color } from "../chess/types";

/** Squares a1..h8 are the first 64 characters; the next 12 are promotions (q, n, r, b × three directions). */
const TCN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$";
const PROMOTIONS = "qnrb";

export interface TcnMove {
  from: string;
  to: string;
  promotion?: string;
}

const square = (i: number) => `${"abcdefgh"[i % 8]}${Math.floor(i / 8) + 1}`;

/** Decodes a TCN move list. Throws on characters outside standard chess (e.g. Crazyhouse drops). */
export function decodeTcn(tcn: string): TcnMove[] {
  const out: TcnMove[] = [];
  for (let k = 0; k + 1 < tcn.length; k += 2) {
    const from = TCN.indexOf(tcn[k]);
    let to = TCN.indexOf(tcn[k + 1]);
    if (from < 0 || from > 63 || to < 0) throw new Error("Not a standard chess move list.");
    let promotion: string | undefined;
    if (to > 63) {
      // A promotion: the code gives the piece and the direction (left, straight, right).
      promotion = PROMOTIONS[Math.floor((to - 64) / 3)];
      to = from + (from < 16 ? -8 : 8) + ((to - 1) % 3) - 1;
    }
    out.push({ from: square(from), to: square(to), ...(promotion ? { promotion } : {}) });
  }
  return out;
}

export interface ChessComCallback {
  game: {
    id: number;
    moveList: string;
    isFinished: boolean;
    pgnHeaders?: Record<string, string | number>;
    initialSetup?: string;
    resultMessage?: string;
    typeName?: string;
    /** When the game ended, in Unix seconds. */
    endTime?: number;
  };
  players?: Partial<Record<"top" | "bottom", { username?: string; color?: "white" | "black"; rating?: number }>>;
}

export interface ChessComGame {
  id: number;
  kind: "live" | "daily";
  pgn: string;
  white: string;
  black: string;
  result: string;
  /** "Ay7u won by checkmate" and the like, as Chess.com words it. */
  message: string;
  /** The colour shown at the bottom of the board (on your own game: yours). */
  bottom: Color;
  url: string;
  /** When the game ended (ms since the epoch), if Chess.com says. */
  endedAt: number | null;
}

/** The PGN and summary of a finished standard game, or null if it isn't one. */
export function gameFromCallback(cb: ChessComCallback, kind: "live" | "daily"): ChessComGame | null {
  const g = cb.game;
  if (!g?.isFinished || !g.moveList) return null;
  if (g.typeName && g.typeName !== "Standard Chess" && g.typeName !== "Chess") return null;
  const h = g.pgnHeaders ?? {};
  const fen = (typeof h.FEN === "string" && h.FEN) || g.initialSetup || START_FEN;
  const chess = new Chess(fen);
  try {
    for (const m of decodeTcn(g.moveList)) chess.move(m);
  } catch {
    return null;
  }
  const url = `https://www.chess.com/game/${kind}/${g.id}`;
  for (const [k, v] of Object.entries(h)) {
    if (k === "SetUp" || k === "FEN") continue;
    chess.setHeader(k, String(v));
  }
  if (fen !== START_FEN) {
    chess.setHeader("SetUp", "1");
    chess.setHeader("FEN", fen);
  }
  chess.setHeader("Link", url);
  return {
    id: g.id,
    kind,
    pgn: chess.pgn(),
    white: String(h.White ?? "White"),
    black: String(h.Black ?? "Black"),
    result: String(h.Result ?? "*"),
    message: g.resultMessage ?? "",
    bottom: cb.players?.bottom?.color === "black" ? "b" : "w",
    url,
    endedAt: typeof g.endTime === "number" ? g.endTime * 1000 : null,
  };
}

/** The game's id and kind from a Chess.com URL or link, in any of its shapes. */
export function chessComGameRef(href: string): { id: number; kind: "live" | "daily" } | null {
  const m =
    /chess\.com\/(?:analysis\/)?game\/(live|daily)\/(\d+)/.exec(href) ??
    /chess\.com\/(live|daily)\/game\/(\d+)/.exec(href) ??
    /chess\.com\/game\/(\d+)(?:[/?#]|$)/.exec(href);
  if (!m) return null;
  return m.length === 3 ? { kind: m[1] as "live" | "daily", id: Number(m[2]) } : { kind: "live", id: Number(m[1]) };
}
