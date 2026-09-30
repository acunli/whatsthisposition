/**
 * Variations: an engine line converted into verified moves, plus pure navigation
 * helpers. Every move is replayed through chess.js, so an illegal or garbled PV
 * is truncated at the first bad move instead of being shown.
 */
import { Chess } from "chess.js";
import type { Color, PieceSymbol, Square } from "./chess/types";

export interface VariationMove {
  uci: string;
  san: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  fenBefore: string;
  fenAfter: string;
  /** Move number as written in notation, e.g. 12 for "12.Nf3" or "12...Nf6". */
  moveNumber: number;
  isCheck: boolean;
  isCastle: boolean;
}

export interface Variation {
  startFen: string;
  moves: VariationMove[];
  /** True if the source line contained a move that isn't legal here. */
  truncated: boolean;
}

export function uciToMoveInput(uci: string) {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: (uci[4] as PieceSymbol | undefined) ?? undefined,
  };
}

export function buildVariation(startFen: string, uciMoves: string[], maxPlies = 40): Variation {
  const chess = new Chess(startFen);
  const moves: VariationMove[] = [];
  let truncated = false;
  for (const uci of uciMoves.slice(0, maxPlies)) {
    const before = chess.fen();
    const moveNumber = Number(before.split(" ")[5]);
    let m;
    try {
      m = chess.move(uciToMoveInput(uci));
    } catch {
      truncated = true;
      break;
    }
    moves.push({
      uci,
      san: m.san,
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      fenBefore: before,
      fenAfter: m.after,
      moveNumber,
      isCheck: m.san.includes("+") || m.san.includes("#"),
      isCastle: m.isKingsideCastle() || m.isQueensideCastle(),
    });
  }
  return { startFen, moves, truncated };
}

/** Converts one UCI move to SAN in a position, or null if illegal. */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move(uciToMoveInput(uci)).san;
  } catch {
    return null;
  }
}

/** ply 0 = start position, ply n = after n moves. */
export function clampPly(v: Variation, ply: number): number {
  return Math.max(0, Math.min(v.moves.length, Math.trunc(ply)));
}

export function fenAtPly(v: Variation, ply: number): string {
  const p = clampPly(v, ply);
  return p === 0 ? v.startFen : v.moves[p - 1].fenAfter;
}

export function moveAtPly(v: Variation, ply: number): VariationMove | null {
  const p = clampPly(v, ply);
  return p === 0 ? null : v.moves[p - 1];
}

export type NavAction = "first" | "prev" | "next" | "last" | { goto: number };

export function navigate(v: Variation, ply: number, action: NavAction): number {
  if (action === "first") return 0;
  if (action === "last") return v.moves.length;
  if (action === "prev") return clampPly(v, ply - 1);
  if (action === "next") return clampPly(v, ply + 1);
  return clampPly(v, action.goto);
}

/** "12.Nf3 Nf6 13.Bg5" style tokens, including the "12..." prefix when Black starts. */
export function formatLine(v: Variation, limit = v.moves.length): { label: string; ply: number }[] {
  const out: { label: string; ply: number }[] = [];
  v.moves.slice(0, limit).forEach((m, i) => {
    let prefix = "";
    if (m.color === "w") prefix = `${m.moveNumber}.`;
    else if (i === 0) prefix = `${m.moveNumber}…`;
    out.push({ label: `${prefix}${m.san}`, ply: i + 1 });
  });
  return out;
}
