/**
 * Shared, memoized static analysis of one position. Every lens builds on this so
 * the same definitions (attacked, defended, en prise, pinned…) are used everywhere.
 */
import { Chess, type Move } from "chess.js";
import {
  ALL_SQUARES,
  BISHOP_DIRS,
  ROOK_DIRS,
  attackersOf,
  attacksFrom,
  clonePlacement,
  fileIndex,
  kingSquare,
  rankIndex,
  toSquare,
} from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, PIECE_VALUE, other, type Color, type Piece, type Placement, type Square } from "../chess/types";

export interface Pin {
  pinned: Square;
  pinner: Square;
  /** The piece behind: the king (absolute pin) or a more valuable piece. */
  behind: Square;
  absolute: boolean;
}

export interface Ctx {
  fen: string;
  p: Placement;
  turn: Color;
  chess: Chess;
  legal: Move[];
  attacks(from: Square): Square[];
  attackers(target: Square, color: Color): Square[];
  /** Attackers that could actually capture on `target` (respecting pins and king safety). */
  capturers(target: Square, color: Color): Square[];
  pins: Pin[];
  inCheck: boolean;
}

export function makeCtx(fen: string): Ctx {
  const chess = new Chess(fen);
  const p = placementFromFen(fen);
  const turn = chess.turn();
  const legal = chess.moves({ verbose: true });
  const attackCache = new Map<Square, Square[]>();
  const attackersCache = new Map<string, Square[]>();
  const attacks = (from: Square) => {
    let a = attackCache.get(from);
    if (!a) {
      a = attacksFrom(p, from);
      attackCache.set(from, a);
    }
    return a;
  };
  const attackers = (target: Square, color: Color) => {
    const key = target + color;
    let a = attackersCache.get(key);
    if (!a) {
      a = attackersOf(p, target, color);
      attackersCache.set(key, a);
    }
    return a;
  };
  const pins = findPins(p);
  const capturers = (target: Square, color: Color): Square[] => {
    if (color === turn) {
      return [...new Set(legal.filter((m) => m.to === target && m.captured).map((m) => m.from))];
    }
    const defended = attackers(target, other(color)).length > 0;
    return attackers(target, color).filter((from) => {
      const piece = p[from]!;
      if (piece.type === "k" && defended) return false;
      const pin = pins.find((x) => x.absolute && x.pinned === from);
      if (!pin) return true;
      // A pinned piece may still capture along the pin line (including the pinner).
      return target === pin.pinner || onLine(pin.pinner, pin.behind, target);
    });
  };
  return { fen, p, turn, chess, legal, attacks, attackers, capturers, pins, inCheck: chess.inCheck() };
}

function onLine(a: Square, b: Square, x: Square): boolean {
  const dx1 = fileIndex(b) - fileIndex(a);
  const dy1 = rankIndex(b) - rankIndex(a);
  const dx2 = fileIndex(x) - fileIndex(a);
  const dy2 = rankIndex(x) - rankIndex(a);
  if (dx1 * dy2 - dy1 * dx2 !== 0) return false;
  const within = (v: number, lo: number, hi: number) => v >= Math.min(lo, hi) && v <= Math.max(lo, hi);
  return within(fileIndex(x), fileIndex(a), fileIndex(b)) && within(rankIndex(x), rankIndex(a), rankIndex(b));
}

export function findPins(p: Placement): Pin[] {
  const pins: Pin[] = [];
  for (const behind of ALL_SQUARES) {
    const target = p[behind];
    if (!target || !["k", "q", "r"].includes(target.type)) continue;
    const absolute = target.type === "k";
    const dirs: [number[], boolean][] = [
      ...ROOK_DIRS.map((d) => [d, true] as [number[], boolean]),
      ...BISHOP_DIRS.map((d) => [d, false] as [number[], boolean]),
    ];
    for (const [[df, dr], straight] of dirs) {
      let f = fileIndex(behind) + df;
      let r = rankIndex(behind) + dr;
      let first: Square | null = null;
      let s = toSquare(f, r);
      while (s) {
        const piece = p[s];
        if (piece) {
          if (!first) {
            if (piece.color !== target.color || piece.type === "k") break;
            first = s;
          } else {
            const slides = piece.type === "q" || (straight ? piece.type === "r" : piece.type === "b");
            if (piece.color !== target.color && slides) {
              const pinnedPiece = p[first]!;
              const meaningful = absolute
                ? true
                : PIECE_VALUE[piece.type] < PIECE_VALUE[target.type] && PIECE_VALUE[pinnedPiece.type] < PIECE_VALUE[target.type];
              if (meaningful) pins.push({ pinned: first, pinner: s, behind, absolute });
            }
            break;
          }
        }
        f += df;
        r += dr;
        s = toSquare(f, r);
      }
    }
  }
  return pins;
}

export const value = (piece: Piece) => (piece.type === "k" ? 100 : PIECE_VALUE[piece.type]);

/** "White's knight on f3" */
export function describe(p: Placement, sq: Square, { owner = true } = {}): string {
  const piece = p[sq];
  if (!piece) return sq;
  return `${owner ? `${COLOR_NAME[piece.color]}'s ` : ""}${PIECE_NAME[piece.type]} on ${sq}`;
}

/** "the knight on f3" */
export function the(p: Placement, sq: Square): string {
  const piece = p[sq];
  return piece ? `the ${PIECE_NAME[piece.type]} on ${sq}` : sq;
}

/** Short tag like "Nf3" or "e4" (pawns). */
export function tag(p: Placement, sq: Square): string {
  const piece = p[sq];
  if (!piece || piece.type === "p") return sq;
  return piece.type.toUpperCase() + sq;
}

export function listSquares(p: Placement, squares: Square[], max = 3): string {
  const items = squares.slice(0, max).map((s) => tag(p, s));
  const rest = squares.length - items.length;
  return items.join(", ") + (rest > 0 ? ` +${rest}` : "");
}

export interface EnPrise {
  sq: Square;
  capturers: Square[];
  defenders: Square[];
  /** "undefended" or "cheaper-attacker" */
  reason: "undefended" | "cheaper";
}

/** A piece that can be captured without an even trade, by static counting. */
export function enPrise(ctx: Pick<Ctx, "p" | "attackers" | "capturers">, sq: Square): EnPrise | null {
  const piece = ctx.p[sq];
  if (!piece || piece.type === "k") return null;
  const enemy = other(piece.color);
  const caps = ctx.capturers(sq, enemy);
  if (!caps.length) return null;
  const defenders = ctx.attackers(sq, piece.color);
  if (!defenders.length) return { sq, capturers: caps, defenders, reason: "undefended" };
  const cheaper = caps.filter((c) => ctx.p[c]!.type !== "k" && value(ctx.p[c]!) < value(piece));
  if (cheaper.length) return { sq, capturers: cheaper, defenders, reason: "cheaper" };
  return null;
}

/** Placement after moving a piece (no legality checks; for "what if" geometry). */
export function movePiece(p: Placement, from: Square, to: Square): Placement {
  const q = clonePlacement(p);
  const piece = q[from];
  delete q[from];
  if (piece) q[to] = piece;
  return q;
}

/**
 * Squares a piece could go to where it isn't immediately lost: not attacked by a
 * cheaper enemy piece, and defended if attacked at all.
 */
export function safeSquares(ctx: Ctx, from: Square): Square[] {
  const piece = ctx.p[from];
  if (!piece) return [];
  const enemy = other(piece.color);
  let dests: Square[];
  if (piece.color === ctx.turn) {
    dests = [...new Set(ctx.legal.filter((m) => m.from === from).map((m) => m.to))];
  } else if (piece.type === "p") {
    dests = [];
  } else {
    dests = ctx.attacks(from).filter((s) => ctx.p[s]?.color !== piece.color);
  }
  return dests.filter((to) => {
    const q = movePiece(ctx.p, from, to);
    const atk = attackersOf(q, to, enemy);
    if (!atk.length) return true;
    if (atk.some((a) => q[a]!.type !== "k" && value(q[a]!) < value(piece))) return false;
    return attackersOf(q, to, piece.color).length > 0;
  });
}

export function sideName(c: Color) {
  return COLOR_NAME[c];
}

export function kingOf(ctx: Ctx, c: Color) {
  return kingSquare(ctx.p, c);
}
