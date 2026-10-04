/**
 * PGN / move-list parsing for game review. Accepts real-world exports (Chess.com,
 * Lichess, ChessBase): headers, comments, clock annotations, variations, NAGs and
 * several games in one file. Variations are dropped; the main line is replayed
 * through chess.js so every move is verified.
 */
import { Chess } from "chess.js";
import { START_FEN } from "../chess/fen";
import type { Color, PieceSymbol, Square } from "../chess/types";

export interface GameMove {
  ply: number;
  san: string;
  uci: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  fenBefore: string;
  fenAfter: string;
  moveNumber: number;
  isCheck: boolean;
  isMate: boolean;
  /** Seconds left on the mover's clock after the move, if the PGN has [%clk]. */
  clock?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: GameMove[];
  white: string;
  black: string;
  whiteElo?: string;
  blackElo?: string;
  result: string;
  /** Opening name from the PGN headers, if present. */
  opening?: string;
}

/** Splits a multi-game PGN into single games. */
export function splitGames(text: string): string[] {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const parts = t.split(/\n(?=\[Event\s)/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function readHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const m of pgn.matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm)) headers[m[1]] = m[2].replace(/\\"/g, '"');
  return headers;
}

/** Removes comments (keeping clocks), variations, NAGs and results: the bare main line. */
export function mainLineTokens(pgn: string): { sans: string[]; clocks: (number | undefined)[] } {
  let body = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, " ");
  // Semicolon comments run to end of line.
  body = body.replace(/;[^\n]*/g, " ");
  const sans: string[] = [];
  const clocks: (number | undefined)[] = [];
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "{") {
      const end = body.indexOf("}", i);
      const comment = body.slice(i + 1, end < 0 ? body.length : end);
      const clk = comment.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
      if (clk && depth === 0 && sans.length) clocks[sans.length - 1] = Number(clk[1]) * 3600 + Number(clk[2]) * 60 + Number(clk[3]);
      i = end < 0 ? body.length : end + 1;
      continue;
    }
    if (ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j < body.length && !/[\s{}()]/.test(body[j])) j++;
    const tok = body.slice(i, j);
    i = j;
    if (depth > 0) continue;
    if (/^\$\d+$/.test(tok)) continue; // NAG
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    const san = tok.replace(/^\d+\.(\.\.)?/, "").replace(/^\.+/, "").replace(/[!?]+$/, "");
    if (!san || /^\d+\.*$/.test(san)) continue;
    sans.push(san);
  }
  return { sans, clocks };
}

export class PgnError extends Error {}

/** Parses one game. Throws PgnError with a readable reason (including the failing move). */
export function parseGame(pgn: string): ParsedGame {
  const headers = readHeaders(pgn);
  const startFen = headers.SetUp === "1" && headers.FEN ? headers.FEN : headers.FEN ?? START_FEN;
  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    throw new PgnError(`The game's starting FEN isn't valid: ${startFen}`);
  }
  const { sans, clocks } = mainLineTokens(pgn);
  if (!sans.length) throw new PgnError("No moves found. Paste a PGN or a move list like “1. e4 e5 2. Nf3”.");
  const moves: GameMove[] = [];
  for (let k = 0; k < sans.length; k++) {
    const before = chess.fen();
    let m;
    try {
      m = chess.move(sans[k], { strict: false } as never);
    } catch {
      const n = Math.floor(k / 2) + 1;
      throw new PgnError(`Move ${n}${k % 2 ? "…" : "."}${sans[k]} isn't legal in this game. Check the PGN around there.`);
    }
    moves.push({
      ply: k + 1,
      san: m.san,
      uci: m.lan,
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      fenBefore: before,
      fenAfter: m.after,
      moveNumber: Number(before.split(" ")[5]),
      isCheck: m.san.includes("+") || m.san.includes("#"),
      isMate: m.san.includes("#"),
      clock: clocks[k],
    });
  }
  return {
    headers,
    startFen,
    moves,
    white: headers.White || "White",
    black: headers.Black || "Black",
    whiteElo: headers.WhiteElo && headers.WhiteElo !== "?" ? headers.WhiteElo : undefined,
    blackElo: headers.BlackElo && headers.BlackElo !== "?" ? headers.BlackElo : undefined,
    result: headers.Result || "*",
    opening: headers.Opening || undefined,
  };
}

/** Parses the first valid game in a (possibly multi-game) PGN. */
export function parseFirstGame(text: string): ParsedGame {
  const games = splitGames(text);
  if (!games.length) throw new PgnError("Paste a PGN first.");
  let last: unknown;
  for (const g of games) {
    try {
      return parseGame(g);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof PgnError ? last : new PgnError("That doesn't look like a PGN.");
}
