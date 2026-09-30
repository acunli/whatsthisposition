/**
 * What each piece is worth *in this position*, measured with the engine's static
 * (NNUE) evaluation: evaluate the position, then evaluate it again without the piece.
 * The difference, from the owner's side, is the piece's value here. This is the same
 * idea older Stockfish versions printed in their `eval` output.
 */
import { ALL_SQUARES } from "../chess/board";
import { boardToFenField, placementFromFen } from "../chess/fen";
import { PIECE_VALUE, type Color, type PieceSymbol, type Square } from "../chess/types";

export interface RemovalProbe {
  sq: Square;
  color: Color;
  type: PieceSymbol;
  fen: string;
}

/** One FEN per non-king piece, with that piece removed (clocks and rights kept as far as legal). */
export function removalProbes(fen: string): RemovalProbe[] {
  const parts = fen.split(" ");
  const p = placementFromFen(fen);
  const out: RemovalProbe[] = [];
  for (const sq of ALL_SQUARES) {
    const x = p[sq];
    if (!x || x.type === "k") continue;
    const q = { ...p };
    delete q[sq];
    let castling = parts[2];
    // Removing a rook from its corner removes that castling right.
    const corner: Record<string, string> = { h1: "K", a1: "Q", h8: "k", a8: "q" };
    if (x.type === "r" && corner[sq]) castling = castling.replace(corner[sq], "") || "-";
    out.push({ sq, color: x.color, type: x.type, fen: [boardToFenField(q), parts[1], castling, "-", parts[4], parts[5]].join(" ") });
  }
  return out;
}

export interface PieceValue {
  sq: Square;
  color: Color;
  type: PieceSymbol;
  /** Engine value in pawns from the owner's side. */
  value: number;
  /** Conventional value (pawn 1, knight 3…). */
  nominal: number;
  /** value − nominal: positive means the piece is doing more than usual. */
  delta: number;
}

/**
 * @param base static eval of the full position (White's view, pawns)
 * @param probes evals of each removal probe (White's view, pawns), or null if unavailable
 */
export function pieceValuesFrom(base: number, probes: { probe: RemovalProbe; eval: number | null }[]): PieceValue[] {
  return probes
    .filter((x) => x.eval !== null)
    .map(({ probe, eval: e }) => {
      const whiteView = base - (e as number);
      const value = probe.color === "w" ? whiteView : -whiteView;
      const nominal = PIECE_VALUE[probe.type];
      return { sq: probe.sq, color: probe.color, type: probe.type, value, nominal, delta: value - nominal };
    });
}

/** Parses Stockfish's `eval` output line. Returns White's view in pawns, or null (e.g. in check). */
export function parseFinalEval(line: string): number | null | undefined {
  if (!line.startsWith("Final evaluation")) return undefined;
  const m = line.match(/Final evaluation:?\s+([+-]?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}
