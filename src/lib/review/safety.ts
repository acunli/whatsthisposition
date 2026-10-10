/**
 * Piece safety for move classification: static exchange evaluation (SEE) with
 * x-rays, "unsafe" pieces, trapped pieces and counter-threats. These decide whether
 * a move really gives material away, which is what separates a Brilliant move
 * from a merely good one. Works on any position.
 *
 * The approach follows the ideas in WintrChess's reporter (GPL-3.0,
 * github.com/WintrCat/wintrchess); this is an independent implementation.
 */
import { Chess } from "chess.js";
import { ALL_SQUARES, attackersOf } from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { PIECE_VALUE, other, type Color, type PieceSymbol, type Placement, type Square } from "../chess/types";

export interface BoardPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

const val = (t: PieceSymbol) => (t === "k" ? 100 : PIECE_VALUE[t]);

function leastValuable(board: Placement, target: Square, side: Color, allowed?: Set<Square>): Square | null {
  let best: Square | null = null;
  for (const a of attackersOf(board, target, side)) {
    if (allowed && !allowed.has(a)) continue;
    if (!best || val(board[a]!.type) < val(board[best]!.type)) best = a;
  }
  return best;
}

/**
 * Material `side` gains by starting a capture sequence on `target` (0 if it
 * shouldn't capture). Removing each capturer from the board reveals x-ray
 * attackers behind it. `firstAttackers` limits the opening capture (e.g. to legal moves).
 */
export function see(p: Placement, target: Square, side: Color, firstAttackers?: Square[]): number {
  const board: Placement = { ...p };
  const victim = board[target];
  if (!victim) return 0;
  const first = leastValuable(board, target, side, firstAttackers ? new Set(firstAttackers) : undefined);
  if (!first) return 0;
  const gain: number[] = [val(victim.type)];
  let onSquare = board[first]!;
  board[target] = onSquare;
  delete board[first];
  let turn = other(side);
  let d = 0;
  for (;;) {
    const next = leastValuable(board, target, turn);
    if (!next) break;
    d++;
    gain[d] = val(onSquare.type) - gain[d - 1];
    if (Math.max(-gain[d - 1], gain[d]) < 0) break;
    onSquare = board[next]!;
    board[target] = onSquare;
    delete board[next];
    turn = other(turn);
  }
  while (d > 0) {
    gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
    d--;
  }
  return Math.max(0, gain[0]);
}

const withTurn = (fen: string, turn: Color) => {
  const parts = fen.split(" ");
  parts[1] = turn;
  parts[3] = "-";
  return parts.join(" ");
};

function legalCapturers(fen: string, target: Square): Square[] | undefined {
  try {
    return new Chess(fen)
      .moves({ verbose: true })
      .filter((m) => m.to === target)
      .map((m) => m.from);
  } catch {
    return undefined;
  }
}

/**
 * Pieces of `color` (not pawns or kings, and worth more than `minValue`) that the
 * opponent can win by exchange. When the opponent is on move, the first capture
 * must be legal; otherwise attacks are counted as if it were their move.
 */
export function unsafePieces(fen: string, color: Color, minValue = 0): BoardPiece[] {
  const p = placementFromFen(fen);
  const opp = other(color);
  const oppToMove = fen.split(" ")[1] === opp;
  const out: BoardPiece[] = [];
  for (const sq of ALL_SQUARES) {
    const x = p[sq];
    if (!x || x.color !== color || x.type === "p" || x.type === "k" || val(x.type) <= minValue) continue;
    const first = oppToMove ? legalCapturers(fen, sq) : undefined;
    if (oppToMove && first && !first.length) continue;
    if (see(p, sq, opp, first) > 0) out.push({ square: sq, type: x.type, color });
  }
  return out;
}

/** Unsafe where it stands, and every move it can make lands it on an unsafe square too. */
export function isTrapped(fen: string, piece: BoardPiece): boolean {
  const own = withTurn(fen, piece.color);
  let chess: Chess;
  try {
    chess = new Chess(own);
  } catch {
    return false;
  }
  const p = placementFromFen(own);
  if (see(p, piece.square, other(piece.color)) <= 0) return false;
  const moves = chess.moves({ square: piece.square, verbose: true });
  return moves.every((m) => {
    if (m.captured && val(m.captured) >= val(piece.type)) return false; // escaping by winning equal material
    const q = placementFromFen(m.after);
    return see(q, m.to, other(piece.color)) > 0;
  });
}

/**
 * True when every way of taking `piece` leaves the taker facing an equal or bigger
 * material threat (a piece of theirs worth at least as much becomes winnable). Then the
 * piece isn't really offered, it is traded. Taking it into mate does NOT count here:
 * WintrChess treats a piece that can't be taken because of mate as not offered, but
 * Chess.com calls such moves Brilliant (16…Rxa3 in BLUNDER-MAN9999999 vs Ay7u, 2026-10-10,
 * where 17.bxa3 allows 17…Bxa3#), and so do players: it is the classic brilliancy.
 */
export function capturesBackfire(fen: string, piece: BoardPiece): boolean {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return false;
  }
  const taker = other(piece.color);
  if (chess.turn() !== taker) return false;
  const captures = chess.moves({ verbose: true }).filter((m) => m.to === piece.square);
  if (!captures.length) return false;
  return captures.every((m) => unsafePieces(m.after, taker).some((u) => val(u.type) >= val(piece.type)));
}

export interface SacrificeInfo {
  pieces: BoardPiece[];
}

/**
 * Does the move give material away for real? Pieces left (or put) en prise count,
 * except when the move rescues pieces, the "sacrificed" piece was lost anyway
 * (trapped), or taking it immediately backfires. `declined` lists pieces the
 * opponent could already have taken on their last turn: leaving those en prise
 * again isn't a new sacrifice (the offer was made, and turned down, earlier).
 */
export function detectSacrifice(fenBefore: string, uci: string, declined: BoardPiece[] = []): SacrificeInfo | null {
  let move;
  const chess = new Chess(fenBefore);
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
  if (move.promotion) return null;
  const mover = move.color;
  const captured = move.captured ? val(move.captured) : 0;
  const before = unsafePieces(withTurn(fenBefore, other(mover)), mover);
  const after = unsafePieces(move.after, mover, captured);
  const afterInCheck = new Chess(move.after).inCheck();
  if (!afterInCheck && after.length < before.length) return null;
  if (!after.length) return null;
  // What they win by taking must be more than the move itself just took: a rook that grabs a
  // knight and is taken by a knight (and taken back) is a trade, not a sacrifice.
  const afterP = placementFromFen(move.after);
  const realLoss = (pc: BoardPiece) => see(afterP, pc.square, other(mover), legalCapturers(move.after, pc.square)) > captured;
  const fresh = after.filter((pc) => (pc.square === move.to || !declined.some((d) => d.square === pc.square && d.type === pc.type)) && realLoss(pc));
  if (!fresh.length) return null;
  if (fresh.every((pc) => capturesBackfire(move.after, pc))) return null;
  const trappedBefore = before.filter((pc) => isTrapped(withTurn(fenBefore, other(mover)), pc));
  const trappedAfter = after.filter((pc) => isTrapped(move.after, pc));
  if (trappedAfter.length === after.length) return null;
  if (trappedBefore.some((pc) => pc.square === move.from)) return null;
  if (trappedAfter.length < trappedBefore.length) return null;
  const pieces = fresh.filter((pc) => !trappedAfter.some((t) => t.square === pc.square));
  return pieces.length ? { pieces } : null;
}

/** Was the piece on `square` free to take (unsafe for its owner) in this position? */
export function wasFreeMaterial(fen: string, square: Square): boolean {
  const p = placementFromFen(fen);
  const x = p[square];
  if (!x) return false;
  const first = legalCapturers(fen, square);
  if (first && !first.length) return false;
  return see(p, square, other(x.color), first) > 0;
}
