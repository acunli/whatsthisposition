/** Line geometry used by the move-reasoning ideas: rays, x-rays, files, king zones. */
import { BISHOP_DIRS, ROOK_DIRS, attackersOf, fileIndex, rankIndex, toSquare } from "../chess/board";
import { PIECE_VALUE, other, type Color, type Placement, type Square } from "../chess/types";

/** Squares along a direction, until the edge, with what stands on them. */
export function ray(p: Placement, from: Square, df: number, dr: number): Square[] {
  const out: Square[] = [];
  let f = fileIndex(from) + df;
  let r = rankIndex(from) + dr;
  let s = toSquare(f, r);
  while (s) {
    out.push(s);
    f += df;
    r += dr;
    s = toSquare(f, r);
  }
  return out;
}

export const dirsOf = (type: string): number[][] => (type === "r" ? ROOK_DIRS : type === "b" ? BISHOP_DIRS : type === "q" ? [...ROOK_DIRS, ...BISHOP_DIRS] : []);

/**
 * Pieces a slider "aims at" along each of its lines: the first enemy piece, possibly
 * behind one blocker (an x-ray). Returns [target, blocker | null].
 */
export function aims(p: Placement, from: Square): { target: Square; through: Square | null; dir: number[] }[] {
  const piece = p[from];
  if (!piece) return [];
  const out: { target: Square; through: Square | null; dir: number[] }[] = [];
  for (const d of dirsOf(piece.type)) {
    let through: Square | null = null;
    for (const s of ray(p, from, d[0], d[1])) {
      const x = p[s];
      if (!x) continue;
      if (x.color !== piece.color) {
        out.push({ target: s, through, dir: d });
        break;
      }
      if (through) break;
      through = s;
    }
  }
  return out;
}

/** Pawns on a file, per colour. */
export function filePawns(p: Placement, f: number): Record<Color, number> {
  const out = { w: 0, b: 0 };
  for (let r = 0; r < 8; r++) {
    const x = p[toSquare(f, r)!];
    if (x?.type === "p") out[x.color]++;
  }
  return out;
}

export function kingZone(k: Square): Square[] {
  const out: Square[] = [k];
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const s = toSquare(fileIndex(k) + df, rankIndex(k) + dr);
      if (s) out.push(s);
    }
  return out;
}

/** Squares around `color`'s king that `by` attacks, counted once per attacker-square pair. */
export function zonePressure(p: Placement, k: Square, by: Color): number {
  let n = 0;
  for (const s of kingZone(k)) n += attackersOf(p, s, by).length;
  return n;
}

/** Is the piece on `sq` loose: attacked, and undefended or attacked by something cheaper? */
export function loose(p: Placement, sq: Square): boolean {
  const x = p[sq];
  if (!x || x.type === "k") return false;
  const atk = attackersOf(p, sq, other(x.color));
  if (!atk.length) return false;
  const def = attackersOf(p, sq, x.color);
  return !def.length || atk.some((a) => p[a]!.type !== "k" && PIECE_VALUE[p[a]!.type] < PIECE_VALUE[x.type]);
}

/** Relative rank from `color`'s side: 0 = own back rank, 7 = the far side. */
export const relRank = (sq: Square, color: Color) => (color === "w" ? rankIndex(sq) : 7 - rankIndex(sq));

export const CENTRE: Square[] = ["d4", "e4", "d5", "e5"];
export const WIDE_CENTRE: Square[] = ["c3", "d3", "e3", "f3", "c4", "d4", "e4", "f4", "c5", "d5", "e5", "f5", "c6", "d6", "e6", "f6"];
