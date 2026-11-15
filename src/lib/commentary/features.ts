/**
 * What the commentary looks at, measured once per position: material, the pawn skeleton,
 * the centre, where the kings are and how well covered, development and space. The rules
 * that turn these into words are in types.ts (position types), points.ts (likes and
 * dislikes) and plans.ts.
 */
import { ALL_SQUARES, FILES, attackersOf, fileIndex, isLightSquare, rankIndex, toSquare } from "../chess/board";
import { PIECE_VALUE, other, type Color, type Piece, type PieceSymbol, type Placement, type Square } from "../chess/types";
import { placementFromFen } from "../chess/fen";
import { activityScore, fileState } from "../facts/activity";
import { makeCtx, type Ctx } from "../facts/context";
import { kingZone } from "../facts/king";
import { classifyPawns, pawnIslands, type PawnInfo } from "../facts/pawns";
import { development, mobilityOf } from "../facts/pieces";
import { spaceFor } from "../facts/space";
import { holes } from "../facts/structure";
import type { Phase } from "./types";

export type Wing = "kingside" | "queenside" | "centre";

/** A rank counted from a side's own back rank: 0 is the back rank, 1 where its pawns start. */
export const rel = (sq: Square, c: Color) => (c === "w" ? rankIndex(sq) : 7 - rankIndex(sq));
/** The square on `file` at a side's relative rank. */
export const relSquare = (file: number, r: number, c: Color) => toSquare(file, c === "w" ? r : 7 - r);
export const fileLetter = (f: number) => FILES[f];
export const wingOfFile = (f: number): Wing => (f <= 2 ? "queenside" : f >= 5 ? "kingside" : "centre");

export interface PieceActivity {
  sq: Square;
  piece: Piece;
  /** Relative to what that piece type usually has (see facts/activity.ts): about 1 is normal. */
  score: number;
  safe: Square[];
}

export interface SideFeatures {
  color: Color;
  king: Square;
  kingWing: Wing;
  /** The king has left the centre files and sits on its first two ranks. */
  castled: boolean;
  canCastle: { k: boolean; q: boolean };
  counts: Record<PieceSymbol, number>;
  /** Material in points, pawns included. */
  points: number;
  /** Material in points without pawns. */
  pieces: number;
  pawns: PawnInfo[];
  /** Relative ranks of this side's pawns, by file. */
  pawnRanks: number[][];
  islands: number;
  holes: Square[];
  space: number;
  /** Minor pieces still on their first squares. */
  home: Square[];
  developed: number;
  bishops: Square[];
  knights: Square[];
  rooks: Square[];
  queens: Square[];
  bishopPair: boolean;
  activity: PieceActivity[];
  /** Own pawns on the three files at the king, one or two ranks in front of it. */
  shelter: Square[];
  /** Files at the king with no own pawn on them. */
  openAtKing: number[];
  /** Enemy pieces (not pawns) that attack a square next to the king. */
  kingAttackers: Square[];
  /** Own pieces (not pawns, not the king) that defend a square next to the king. */
  kingDefenders: Square[];
  /** Pawns per wing: files a–c, d–e, f–h. */
  wingPawns: Record<Wing, number>;
}

export interface Centre {
  kind: "open" | "closed" | "mobile" | "tension" | "fixed" | "semi-open";
  /** Files (3 = d, 4 = e) where a pawn of each colour stands head to head. */
  locked: number[];
  /** Pawn captures available between the c- to f-files that involve a d- or e-pawn: [white pawn, black pawn]. */
  contacts: [Square, Square][];
  /** The side with two centre pawns abreast that can still advance. */
  mobileSide?: Color;
}

export interface Features {
  ctx: Ctx;
  p: Placement;
  fen: string;
  turn: Color;
  fullmove: number;
  w: SideFeatures;
  b: SideFeatures;
  phase: Phase;
  queensOn: boolean;
  centre: Centre;
  /** Files with no pawns at all. */
  openFiles: number[];
  of(c: Color): SideFeatures;
}

const pawnSquares = (p: Placement, c: Color) => ALL_SQUARES.filter((s) => p[s]?.type === "p" && p[s]?.color === c);
const squaresOf = (p: Placement, c: Color, t: PieceSymbol) => ALL_SQUARES.filter((s) => p[s]?.type === t && p[s]?.color === c);

function sideFeatures(ctx: Ctx, c: Color, allPawns: PawnInfo[], settled?: Placement): SideFeatures {
  const { p } = ctx;
  const them = other(c);
  const king = squaresOf(p, c, "k")[0] ?? (c === "w" ? "e1" : "e8");
  const kf = fileIndex(king);
  const kr = rel(king, c);
  // Material is counted where the pieces will stand once a capture in progress is finished.
  const counts: Record<PieceSymbol, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  const counted = settled ?? p;
  for (const sq of ALL_SQUARES) if (counted[sq]?.color === c) counts[counted[sq]!.type]++;
  const pieces = counts.n * 3 + counts.b * 3 + counts.r * 5 + counts.q * 9;
  const rights = ctx.fen.split(" ")[2] ?? "-";
  const dev = development(p, c);
  const bishops = squaresOf(p, c, "b");
  const fwd = c === "w" ? 1 : -1;
  const shelter: Square[] = [];
  const openAtKing: number[] = [];
  for (let df = -1; df <= 1; df++) {
    const f = kf + df;
    if (f < 0 || f > 7) continue;
    if (!fileState(p, f)[c]) openAtKing.push(f);
    for (const dr of [1, 2]) {
      const s = toSquare(f, rankIndex(king) + dr * fwd);
      if (s && p[s]?.type === "p" && p[s]!.color === c) shelter.push(s);
    }
  }
  const zone = [king, ...kingZone(king)];
  const near = (side: Color) => [...new Set(zone.flatMap((s) => attackersOf(p, s, side)))].filter((s) => p[s] && p[s]!.type !== "p" && p[s]!.type !== "k");
  const pawnRanks: number[][] = Array.from({ length: 8 }, () => []);
  for (const s of pawnSquares(p, c)) pawnRanks[fileIndex(s)].push(rel(s, c));
  const wingPawns: Record<Wing, number> = { queenside: 0, centre: 0, kingside: 0 };
  for (const s of pawnSquares(p, c)) wingPawns[wingOfFile(fileIndex(s))]++;
  return {
    color: c,
    king,
    kingWing: wingOfFile(kf),
    castled: kr <= 1 && (kf <= 2 || kf >= 6),
    canCastle: { k: rights.includes(c === "w" ? "K" : "k"), q: rights.includes(c === "w" ? "Q" : "q") },
    counts,
    points: pieces + counts.p * PIECE_VALUE.p,
    pieces,
    pawns: allPawns.filter((x) => x.color === c),
    pawnRanks,
    islands: pawnIslands(p, c),
    holes: holes(p, c),
    space: spaceFor(p, c).score,
    home: dev.home,
    developed: dev.out,
    bishops,
    knights: squaresOf(p, c, "n"),
    rooks: squaresOf(p, c, "r"),
    queens: squaresOf(p, c, "q"),
    bishopPair: counts.b >= 2 && bishops.length >= 2 && bishops.some(isLightSquare) && bishops.some((s) => !isLightSquare(s)),
    activity: mobilityOf(ctx, c).map((m) => ({ sq: m.sq, piece: p[m.sq]!, score: activityScore(ctx, m), safe: m.safe })),
    shelter,
    openAtKing,
    kingAttackers: near(them),
    kingDefenders: near(c),
    wingPawns,
  };
}

function centreOf(p: Placement, w: SideFeatures, b: SideFeatures): Centre {
  const pawn = (s: Square | null, c: Color) => !!s && p[s]?.type === "p" && p[s]!.color === c;
  const locked: number[] = [];
  for (const f of [3, 4]) for (let r = 1; r < 6; r++) if (pawn(toSquare(f, r), "w") && pawn(toSquare(f, r + 1), "b")) locked.push(f);
  const contacts: [Square, Square][] = [];
  for (const s of pawnSquares(p, "w")) {
    const f = fileIndex(s);
    if (f < 2 || f > 5) continue;
    for (const df of [-1, 1]) {
      const t = toSquare(f + df, rankIndex(s) + 1);
      if (!t || !pawn(t, "b")) continue;
      const tf = fileIndex(t);
      if ((f === 3 || f === 4 || tf === 3 || tf === 4) && tf >= 2 && tf <= 5) contacts.push([s, t]);
    }
  }
  const total = w.pawnRanks[3].length + w.pawnRanks[4].length + b.pawnRanks[3].length + b.pawnRanks[4].length;
  let mobileSide: Color | undefined;
  for (const [me, them] of [[w, b], [b, w]] as [SideFeatures, SideFeatures][]) {
    const d = Math.max(-1, ...me.pawnRanks[3]);
    const e = Math.max(-1, ...me.pawnRanks[4]);
    if (d < 3 || e < 3 || Math.abs(d - e) > 1) continue;
    // Neither pawn is blocked by a pawn, and the other side hasn't put a pawn of its own on its fourth rank or beyond there.
    const free = [3, 4].every((f) => {
      const r = f === 3 ? d : e;
      return !pawn(relSquare(f, r + 1, me.color), them.color);
    });
    const staked = [3, 4].some((f) => them.pawnRanks[f].some((r) => r >= 3));
    if (free && !staked) mobileSide = me.color;
  }
  const kind: Centre["kind"] =
    locked.includes(3) && locked.includes(4) ? "closed" : total <= 1 ? "open" : mobileSide ? "mobile" : contacts.length ? "tension" : locked.length ? "fixed" : "semi-open";
  return { kind, locked, contacts, mobileSide: kind === "mobile" ? mobileSide : undefined };
}

function phaseOf(w: SideFeatures, b: SideFeatures, fullmove: number): Phase {
  const queens = w.counts.q + b.counts.q;
  const most = Math.max(w.pieces, b.pieces);
  if (queens === 0 && most <= 13) return "endgame";
  // With queens on: nothing beyond a queen and a rook each, or a queen and a minor piece.
  if (queens > 0 && most <= 14) return "endgame";
  // Still developing: early, most of the pieces on, and minor pieces at home or kings not yet safe.
  const atHome = w.home.length + b.home.length;
  const uncastled = [w, b].filter((s) => !s.castled && (s.canCastle.k || s.canCastle.q)).length;
  if (fullmove <= 14 && w.pieces + b.pieces >= 50 && (atHome >= 3 || (atHome >= 1 && uncastled >= 1) || uncastled === 2)) return "opening";
  return queens === 0 ? "queenless" : "middlegame";
}

/**
 * `settledFen`: the position after the exchange the engine's line starts with, when there is
 * one. A piece that is about to be taken back is not a piece up, so material (and the phase
 * that follows from it) is counted there; everything else is read from the board as it stands.
 */
export function features(fen: string, given?: Ctx, settledFen?: string): Features {
  const ctx = given ?? makeCtx(fen);
  const { p } = ctx;
  const all = classifyPawns(p);
  const settled = settledFen ? placementFromFen(settledFen) : undefined;
  const w = sideFeatures(ctx, "w", all, settled);
  const b = sideFeatures(ctx, "b", all, settled);
  const fullmove = Number(fen.split(" ")[5] ?? 1) || 1;
  const openFiles = [0, 1, 2, 3, 4, 5, 6, 7].filter((f) => {
    const st = fileState(p, f);
    return !st.w && !st.b;
  });
  return {
    ctx,
    p,
    fen,
    turn: ctx.turn,
    fullmove,
    w,
    b,
    phase: phaseOf(w, b, fullmove),
    queensOn: w.counts.q + b.counts.q > 0,
    centre: centreOf(p, w, b),
    openFiles,
    of: (c) => (c === "w" ? w : b),
  };
}

export interface MaterialWords {
  /** The side that is ahead (in points, or in bigger pieces when the points are level). */
  side: Color;
  /** "a pawn up", "the exchange up", "a queen for a knight and a pawn". */
  text: string;
  points: number;
  /** Different kinds of pieces on each side, not simply more of the same. */
  mixed: boolean;
}

/** Who is ahead in material and how to say it. Null when both sides have the same pieces (a bishop for a knight counts as the same). */
export function materialWords(f: Features): MaterialWords | null {
  const d = (t: PieceSymbol) => f.w.counts[t] - f.b.counts[t];
  const points = f.w.points - f.b.points;
  const minors = d("n") + d("b");
  if (!d("p") && !minors && !d("r") && !d("q")) return null;
  const big = d("q") * 100 + d("r") * 10 + minors;
  const side: Color = points > 0 || (points === 0 && big > 0) ? "w" : "b";
  const s = side === "w" ? 1 : -1;
  const [P, R, Q] = [d("p") * s, d("r") * s, d("q") * s];
  // A bishop for a knight is no difference in material: only the surplus of minor pieces counts.
  let B = d("b") * s;
  let N = d("n") * s;
  if (Math.sign(B) * Math.sign(N) < 0) {
    const cancel = Math.min(Math.abs(B), Math.abs(N));
    B -= Math.sign(B) * cancel;
    N -= Math.sign(N) * cancel;
  }
  const M = B + N;
  const num = (n: number) => ["no", "a", "two", "three", "four", "five", "six", "seven", "eight"][n] ?? String(n);
  const some = (n: number, one: string, many: string) => (n === 1 ? `${/^[aeiou]/.test(one) ? "an" : "a"} ${one}` : `${num(n)} ${many}`);
  const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const abs = Math.abs(points);
  if (!M && !R && !Q) return { side, text: `${some(P, "pawn", "pawns")} up`, points: abs, mixed: false };
  if (!Q && R === 1 && M === -1) return { side, text: P < 0 ? `the exchange for ${some(-P, "pawn", "pawns")}` : P > 0 ? `the exchange and ${some(P, "pawn", "pawns")} up` : "the exchange up", points: abs, mixed: true };
  const parts = (sign: number) => {
    const out: string[] = [];
    if (Q * sign > 0) out.push(some(Q * sign, "queen", "queens"));
    if (R * sign > 0) out.push(some(R * sign, "rook", "rooks"));
    // Minor pieces by name when they are all of one kind, "pieces" otherwise.
    const b = B * sign;
    const n = N * sign;
    if (b > 0 && n > 0) out.push(some(b + n, "minor piece", "minor pieces"));
    else if (b > 0) out.push(some(b, "bishop", "bishops"));
    else if (n > 0) out.push(some(n, "knight", "knights"));
    if (P * sign > 0) out.push(some(P * sign, "pawn", "pawns"));
    return out;
  };
  const plus = parts(1);
  const minus = parts(-1);
  if (!plus.length) return null;
  const onlyMinor = plus.length === 1 && M === 1 && !R && !Q && P <= 0;
  const head = onlyMinor ? "a piece" : join(plus);
  return { side, text: minus.length ? `${head} for ${join(minus)}` : `${head} up`, points: abs, mixed: minus.some((x) => !/pawn/.test(x)) || (minus.length > 0 && plus.some((x) => !/pawn/.test(x))) };
}
