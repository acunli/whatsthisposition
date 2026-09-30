import type { Color, PieceSymbol, Square } from "chess.js";

export type { Color, PieceSymbol, Square };

export interface Piece {
  color: Color;
  type: PieceSymbol;
}

/** Sparse map of occupied squares. */
export type Placement = Partial<Record<Square, Piece>>;

export interface CastlingRights {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

/**
 * Everything needed to describe a position. `turn` is nullable because a photo
 * never tells us whose move it is — the player must choose.
 */
export interface PositionSetup {
  placement: Placement;
  turn: Color | null;
  castling: CastlingRights;
  epSquare: Square | null;
  halfmove: number;
  fullmove: number;
}

export const COLOR_NAME: Record<Color, string> = { w: "White", b: "Black" };

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Conventional material values, used only for material counts and exchange hints. */
export const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export const other = (c: Color): Color => (c === "w" ? "b" : "w");
