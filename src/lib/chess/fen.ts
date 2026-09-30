/**
 * FEN parsing, serialization and position validation.
 *
 * Validation returns human-readable issues tied to squares so the editor can point
 * at what needs fixing, instead of silently "repairing" a position.
 */
import { Chess, validateFen as chessJsValidate } from "chess.js";
import { ALL_SQUARES, attackersOf, fileIndex, kingSquare, rankIndex, toSquare } from "./board";
import type { CastlingRights, Color, Piece, PieceSymbol, Placement, PositionSetup, Square } from "./types";
import { COLOR_NAME } from "./types";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const EMPTY_CASTLING: CastlingRights = { K: false, Q: false, k: false, q: false };

export interface Issue {
  /** Stable machine code, handy for tests and for choosing an icon. */
  code: string;
  message: string;
  squares?: Square[];
  /** Which control the player should look at to fix it. */
  field?: "board" | "turn" | "castling" | "ep" | "fen";
}

export type ParseResult =
  | { ok: true; setup: PositionSetup }
  | { ok: false; issues: Issue[] };

const PIECE_CHARS = "pnbrqkPNBRQK";

export function pieceFromChar(ch: string): Piece | null {
  if (!PIECE_CHARS.includes(ch) || ch.length !== 1) return null;
  const lower = ch.toLowerCase() as PieceSymbol;
  return { color: ch === lower ? "b" : "w", type: lower };
}

export function pieceToChar(p: Piece): string {
  return p.color === "w" ? p.type.toUpperCase() : p.type;
}

/** Parses the board field only. */
export function parseBoardField(field: string): { placement: Placement } | { error: string } {
  const rows = field.split("/");
  if (rows.length !== 8) return { error: `The board needs 8 ranks separated by "/", found ${rows.length}.` };
  const placement: Placement = {};
  for (let i = 0; i < 8; i++) {
    const rank = 7 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
      } else {
        const piece = pieceFromChar(ch);
        if (!piece) return { error: `Unknown piece letter "${ch}" on rank ${rank + 1}.` };
        const sq = toSquare(file, rank);
        if (!sq) return { error: `Rank ${rank + 1} has more than 8 squares.` };
        placement[sq] = piece;
        file += 1;
      }
    }
    if (file !== 8) return { error: `Rank ${rank + 1} describes ${file} squares instead of 8.` };
  }
  return { placement };
}

/**
 * Parses a full or partial FEN. Missing trailing fields fall back to "-" / 0 / 1,
 * except the side to move, which must be present.
 */
export function parseFen(input: string): ParseResult {
  const fen = input.trim().replace(/\s+/g, " ");
  if (!fen) return { ok: false, issues: [{ code: "fen-empty", message: "Paste a FEN string first.", field: "fen" }] };
  const [boardField, turnField, castlingField = "-", epField = "-", half = "0", full = "1"] = fen.split(" ");
  const board = parseBoardField(boardField);
  if ("error" in board) return { ok: false, issues: [{ code: "fen-board", message: board.error, field: "fen" }] };

  const issues: Issue[] = [];
  let turn: Color | null = null;
  if (turnField === "w" || turnField === "b") turn = turnField;
  else
    issues.push({
      code: "fen-turn",
      message: turnField ? `Side to move must be "w" or "b", not "${turnField}".` : "The FEN is missing the side to move (w or b).",
      field: "fen",
    });

  const castling = { ...EMPTY_CASTLING };
  if (castlingField !== "-") {
    if (!/^[KQkq]{1,4}$/.test(castlingField) || new Set(castlingField).size !== castlingField.length) {
      issues.push({ code: "fen-castling", message: `Castling field "${castlingField}" isn't valid (use KQkq or -).`, field: "fen" });
    } else {
      for (const ch of castlingField) castling[ch as keyof CastlingRights] = true;
    }
  }

  let epSquare: Square | null = null;
  if (epField !== "-") {
    if (/^[a-h][36]$/.test(epField)) epSquare = epField as Square;
    else issues.push({ code: "fen-ep", message: `En passant square "${epField}" isn't valid.`, field: "fen" });
  }

  const halfmove = Number(half);
  const fullmove = Number(full);
  if (!Number.isInteger(halfmove) || halfmove < 0)
    issues.push({ code: "fen-halfmove", message: "Halfmove clock must be a whole number.", field: "fen" });
  if (!Number.isInteger(fullmove) || fullmove < 1)
    issues.push({ code: "fen-fullmove", message: "Move number must be 1 or more.", field: "fen" });

  if (issues.length) return { ok: false, issues };
  return { ok: true, setup: { placement: board.placement, turn, castling, epSquare, halfmove, fullmove } };
}

export function boardToFenField(p: Placement): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = p[toSquare(file, rank)!];
      if (piece) {
        if (empty) row += String(empty);
        empty = 0;
        row += pieceToChar(piece);
      } else empty += 1;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join("/");
}

export function castlingToField(c: CastlingRights): string {
  const s = (c.K ? "K" : "") + (c.Q ? "Q" : "") + (c.k ? "k" : "") + (c.q ? "q" : "");
  return s || "-";
}

/** Serializes a setup. Requires a chosen side to move. */
export function setupToFen(s: PositionSetup): string {
  if (!s.turn) throw new Error("Side to move is not set");
  return [boardToFenField(s.placement), s.turn, castlingToField(s.castling), s.epSquare ?? "-", s.halfmove, s.fullmove].join(" ");
}

/** Castling rights that the piece placement still allows (king and rook on home squares). */
export function possibleCastling(p: Placement): CastlingRights {
  const is = (sq: Square, ch: string) => {
    const piece = p[sq];
    return !!piece && pieceToChar(piece) === ch;
  };
  return {
    K: is("e1", "K") && is("h1", "R"),
    Q: is("e1", "K") && is("a1", "R"),
    k: is("e8", "k") && is("h8", "r"),
    q: is("e8", "k") && is("a8", "r"),
  };
}

/** En passant target squares that are consistent with the placement for this side to move. */
export function possibleEpSquares(p: Placement, turn: Color): Square[] {
  const out: Square[] = [];
  const pawnRank = turn === "w" ? 4 : 3; // rank index of the pawn that just double-pushed
  const targetRank = turn === "w" ? 5 : 2;
  const originRank = turn === "w" ? 6 : 1;
  const mover: Color = turn === "w" ? "b" : "w";
  for (let file = 0; file < 8; file++) {
    const pawnSq = toSquare(file, pawnRank)!;
    const target = toSquare(file, targetRank)!;
    const origin = toSquare(file, originRank)!;
    const pawn = p[pawnSq];
    if (!pawn || pawn.type !== "p" || pawn.color !== mover) continue;
    if (p[target] || p[origin]) continue;
    out.push(target);
  }
  return out;
}

/**
 * Checks a position for legality problems a player can fix. Returns an empty list
 * for a position that can be analyzed.
 */
export function validateSetup(s: PositionSetup): Issue[] {
  const issues: Issue[] = [];
  const p = s.placement;

  if (!s.turn) {
    issues.push({ code: "turn-missing", message: "Choose whose turn it is. A photo can't tell us.", field: "turn" });
  }

  for (const color of ["w", "b"] as Color[]) {
    const kings = ALL_SQUARES.filter((sq) => p[sq]?.type === "k" && p[sq]?.color === color);
    if (kings.length === 0)
      issues.push({ code: `king-missing-${color}`, message: `${COLOR_NAME[color]} has no king on the board.`, field: "board" });
    if (kings.length > 1)
      issues.push({ code: `king-extra-${color}`, message: `${COLOR_NAME[color]} has ${kings.length} kings.`, squares: kings, field: "board" });

    const mine = ALL_SQUARES.filter((sq) => p[sq]?.color === color);
    const count = (t: PieceSymbol) => mine.filter((sq) => p[sq]!.type === t).length;
    const pawns = count("p");
    if (pawns > 8)
      issues.push({ code: `pawns-extra-${color}`, message: `${COLOR_NAME[color]} has ${pawns} pawns; the most possible is 8.`, field: "board" });
    if (mine.length > 16)
      issues.push({ code: `pieces-extra-${color}`, message: `${COLOR_NAME[color]} has ${mine.length} pieces; the most possible is 16.`, field: "board" });
    // Each promoted piece used up a pawn.
    const extras =
      Math.max(0, count("q") - 1) + Math.max(0, count("r") - 2) + Math.max(0, count("b") - 2) + Math.max(0, count("n") - 2);
    if (extras > 8 - pawns)
      issues.push({
        code: `promotions-${color}`,
        message: `${COLOR_NAME[color]} has more extra queens/rooks/minor pieces than missing pawns could have promoted into.`,
        field: "board",
      });
  }

  const backRankPawns = ALL_SQUARES.filter((sq) => p[sq]?.type === "p" && (rankIndex(sq) === 0 || rankIndex(sq) === 7));
  if (backRankPawns.length)
    issues.push({
      code: "pawn-back-rank",
      message: "Pawns can't stand on the first or eighth rank.",
      squares: backRankPawns,
      field: "board",
    });

  const wk = kingSquare(p, "w");
  const bk = kingSquare(p, "b");
  if (wk && bk && Math.abs(fileIndex(wk) - fileIndex(bk)) <= 1 && Math.abs(rankIndex(wk) - rankIndex(bk)) <= 1)
    issues.push({ code: "kings-adjacent", message: "The two kings can't stand next to each other.", squares: [wk, bk], field: "board" });

  if (s.turn && wk && bk) {
    const waiting: Color = s.turn === "w" ? "b" : "w";
    const waitingKing = waiting === "w" ? wk : bk;
    const checkers = attackersOf(p, waitingKing, s.turn);
    if (checkers.length)
      issues.push({
        code: "wrong-side-in-check",
        message: `${COLOR_NAME[waiting]} is in check but it's ${COLOR_NAME[s.turn]}'s move. Either the side to move is wrong or a piece is misplaced.`,
        squares: [waitingKing, ...checkers],
        field: "turn",
      });
    const moverKing = s.turn === "w" ? wk : bk;
    const moverCheckers = attackersOf(p, moverKing, waiting);
    if (moverCheckers.length > 2)
      issues.push({
        code: "too-many-checks",
        message: `${COLOR_NAME[s.turn]}'s king is attacked by ${moverCheckers.length} pieces at once, which can't happen in a real game.`,
        squares: [moverKing, ...moverCheckers],
        field: "board",
      });
  }

  const allowed = possibleCastling(p);
  const bad = (Object.keys(s.castling) as (keyof CastlingRights)[]).filter((k) => s.castling[k] && !allowed[k]);
  if (bad.length) {
    const names: Record<keyof CastlingRights, string> = {
      K: "White kingside (needs king e1, rook h1)",
      Q: "White queenside (needs king e1, rook a1)",
      k: "Black kingside (needs king e8, rook h8)",
      q: "Black queenside (needs king e8, rook a8)",
    };
    issues.push({
      code: "castling-impossible",
      message: `Castling rights don't match the pieces: ${bad.map((k) => names[k]).join("; ")}.`,
      field: "castling",
    });
  }

  if (s.epSquare) {
    if (!s.turn || !possibleEpSquares(p, s.turn).includes(s.epSquare))
      issues.push({
        code: "ep-impossible",
        message: `En passant on ${s.epSquare} isn't possible: it needs an enemy pawn that just moved two squares past it.`,
        squares: [s.epSquare],
        field: "ep",
      });
  }

  // Backstop: chess.js' own structural checks, only when ours found nothing.
  if (!issues.length && s.turn) {
    const res = chessJsValidate(setupToFen(s));
    if (!res.ok) issues.push({ code: "fen-invalid", message: res.error ?? "This position isn't valid.", field: "board" });
  }
  return issues;
}

export interface GameStatus {
  kind: "ongoing" | "checkmate" | "stalemate" | "insufficient";
  message?: string;
}

/** Terminal states worth telling the player about before running the engine. */
export function gameStatus(fen: string): GameStatus {
  const c = new Chess(fen);
  const side = COLOR_NAME[c.turn()];
  if (c.isCheckmate()) return { kind: "checkmate", message: `${side} is checkmated. There's nothing left to analyze.` };
  if (c.isStalemate()) return { kind: "stalemate", message: `${side} has no legal moves and isn't in check: stalemate.` };
  if (c.isInsufficientMaterial()) return { kind: "insufficient", message: "Neither side has enough material to checkmate." };
  return { kind: "ongoing" };
}

export function setupFromFen(fen: string): PositionSetup {
  const r = parseFen(fen);
  if (!r.ok) throw new Error(r.issues[0].message);
  return r.setup;
}

export function placementFromFen(fen: string): Placement {
  return setupFromFen(fen).placement;
}
