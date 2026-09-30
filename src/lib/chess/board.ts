/**
 * Board geometry and static attack maps. Pure functions over a Placement, so the
 * visual-fact modules can reason about any position (including the side that is
 * not to move) without going through move generation.
 */
import type { Color, Piece, Placement, Square } from "./types";

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export const ALL_SQUARES: Square[] = RANKS.flatMap((r) => FILES.map((f) => `${f}${r}` as Square));

export function fileIndex(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}

export function rankIndex(sq: Square): number {
  return sq.charCodeAt(1) - 49;
}

export function toSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${RANKS[rank]}` as Square;
}

export function isLightSquare(sq: Square): boolean {
  return (fileIndex(sq) + rankIndex(sq)) % 2 === 1;
}

export function kingSquare(p: Placement, color: Color): Square | null {
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (piece && piece.type === "k" && piece.color === color) return sq;
  }
  return null;
}

export function piecesOf(p: Placement, color: Color): [Square, Piece][] {
  const out: [Square, Piece][] = [];
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (piece && piece.color === color) out.push([sq, piece]);
  }
  return out;
}

const KNIGHT_STEPS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
export const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Squares attacked (controlled) by the piece on `from`. Sliders stop at the first
 * occupied square and include it; pawns attack diagonally only.
 */
export function attacksFrom(p: Placement, from: Square): Square[] {
  const piece = p[from];
  if (!piece) return [];
  const f = fileIndex(from);
  const r = rankIndex(from);
  const out: Square[] = [];
  const step = (df: number, dr: number) => {
    const s = toSquare(f + df, r + dr);
    if (s) out.push(s);
  };
  const slide = (dirs: number[][]) => {
    for (const [df, dr] of dirs) {
      let nf = f + df;
      let nr = r + dr;
      let s = toSquare(nf, nr);
      while (s) {
        out.push(s);
        if (p[s]) break;
        nf += df;
        nr += dr;
        s = toSquare(nf, nr);
      }
    }
  };
  switch (piece.type) {
    case "p": {
      const dir = piece.color === "w" ? 1 : -1;
      step(-1, dir);
      step(1, dir);
      break;
    }
    case "n":
      KNIGHT_STEPS.forEach(([df, dr]) => step(df, dr));
      break;
    case "k":
      KING_STEPS.forEach(([df, dr]) => step(df, dr));
      break;
    case "b":
      slide(BISHOP_DIRS);
      break;
    case "r":
      slide(ROOK_DIRS);
      break;
    case "q":
      slide([...ROOK_DIRS, ...BISHOP_DIRS]);
      break;
  }
  return out;
}

/** Squares of `color` pieces that attack `target`. */
export function attackersOf(p: Placement, target: Square, color: Color): Square[] {
  const out: Square[] = [];
  for (const [sq] of piecesOf(p, color)) {
    if (attacksFrom(p, sq).includes(target)) out.push(sq);
  }
  return out;
}

/** Number of attackers per square for each color. */
export function controlMap(p: Placement): Record<Square, { w: number; b: number }> {
  const map = {} as Record<Square, { w: number; b: number }>;
  for (const sq of ALL_SQUARES) map[sq] = { w: 0, b: 0 };
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (!piece) continue;
    for (const t of attacksFrom(p, sq)) map[t][piece.color] += 1;
  }
  return map;
}

export function isAttackedBy(p: Placement, target: Square, color: Color): boolean {
  return attackersOf(p, target, color).length > 0;
}

/** Squares strictly between two squares on a shared line (empty if not aligned). */
export function between(a: Square, b: Square): Square[] {
  const df = Math.sign(fileIndex(b) - fileIndex(a));
  const dr = Math.sign(rankIndex(b) - rankIndex(a));
  const adf = Math.abs(fileIndex(b) - fileIndex(a));
  const adr = Math.abs(rankIndex(b) - rankIndex(a));
  if (!(adf === 0 || adr === 0 || adf === adr)) return [];
  const out: Square[] = [];
  let f = fileIndex(a) + df;
  let r = rankIndex(a) + dr;
  while (f !== fileIndex(b) || r !== rankIndex(b)) {
    out.push(toSquare(f, r)!);
    f += df;
    r += dr;
  }
  return out;
}

export function clonePlacement(p: Placement): Placement {
  const out: Placement = {};
  for (const sq of Object.keys(p) as Square[]) {
    const piece = p[sq];
    if (piece) out[sq] = { ...piece };
  }
  return out;
}
