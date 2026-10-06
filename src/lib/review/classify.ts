/**
 * Move classification for game review, in the style of Chess.com's Game Review.
 *
 * Every move is judged by how much of the mover's expected score (win chance)
 * it gives up compared with the engine's best move:
 *   Best (top move) · Excellent < 2% · Good < 5% · Inaccuracy < 10% · Mistake < 20% · Blunder ≥ 20%
 * with mate-aware rules, plus the special labels:
 *   Book       the position after the move is opening theory (while the game is still in book)
 *   Forced     the only legal move
 *   Great      the best move when every alternative is clearly worse (≥ 10% loss)
 *   Brilliant  the best move, it really gives material away (see safety.ts), and it is clearly
 *              better than the next-best move (BRILLIANT_GAP)
 *   Miss       failing to punish the opponent's mistake without actually making things worse
 *
 * Expected score uses Lichess's win% curve. Thresholds match Chess.com's published
 * expected-points bands; Great/Brilliant gating follows WintrChess's ideas.
 */
import { Chess } from "chess.js";
import type { Color } from "../chess/types";
import type { EngineLine } from "../engine/client";
import { evalFor, type Evaluation } from "../engine/score";
import { detectSacrifice, unsafePieces, wasFreeMaterial, type SacrificeInfo } from "./safety";
import type { MasterMove } from "./masters";
import type { GameMove } from "./pgn";

export type MoveClass =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder"
  | "forced";

export const CLASS_ORDER: MoveClass[] = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder", "forced"];

export const CLASS_INFO: Record<MoveClass, { label: string; symbol: string; color: string }> = {
  brilliant: { label: "Brilliant", symbol: "!!", color: "#1fc0a8" },
  great: { label: "Great", symbol: "!", color: "#5b8fd6" },
  best: { label: "Best", symbol: "★", color: "#86b93f" },
  excellent: { label: "Excellent", symbol: "👍", color: "#9cc24a" },
  good: { label: "Good", symbol: "✓", color: "#86a96a" },
  book: { label: "Book", symbol: "📖", color: "#b08d64" },
  inaccuracy: { label: "Inaccuracy", symbol: "?!", color: "#f2c13a" },
  mistake: { label: "Mistake", symbol: "?", color: "#ef8f2f" },
  miss: { label: "Miss", symbol: "✕", color: "#e86a6a" },
  blunder: { label: "Blunder", symbol: "??", color: "#e0362f" },
  forced: { label: "Forced", symbol: "→", color: "#9aa3ad" },
};

/** How much better (expected score) a sacrifice must be than the next-best move to be Brilliant. */
export const BRILLIANT_GAP = 0.04;

/** Chess annotation marks, for writing a move as e.g. "16.Qb8+!!". */
export const ANNOTATION: Partial<Record<MoveClass, string>> = { brilliant: "!!", great: "!", inaccuracy: "?!", mistake: "?", miss: "?", blunder: "??" };

/** Lichess's win-chance curve, as a 0–1 expected score for `color`. */
export function expectedScore(e: Evaluation, color: Color): number {
  if (e.kind === "mate") return e.winner === color ? 1 : 0;
  const cp = color === "w" ? e.cp : -e.cp;
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

export interface PositionAnalysis {
  /** Engine lines for the position (best first). Empty for game-over positions. */
  lines: EngineLine[];
  /** Eval to use for the position (best line, or the game-over result). */
  eval: Evaluation;
  depth: number;
}

export interface ClassifiedMove {
  move: GameMove;
  cls: MoveClass;
  /** Expected-score loss for the mover, 0–1. */
  loss: number;
  /** Mover's expected score before (best play) and after the move, 0–1. */
  before: number;
  after: number;
  /** Lichess move accuracy, 0–100. */
  accuracy: number;
  bestUci: string | null;
  bestSan: string | null;
  bestLine: EngineLine | null;
  secondLine: EngineLine | null;
  /** The game line after the move, from the engine (opponent to move). */
  replyLine: EngineLine | null;
  evalBefore: Evaluation;
  evalAfter: Evaluation;
  sacrifice: SacrificeInfo | null;
  /** For Miss: the opponent's mistake that went unpunished. */
  missedPly?: number;
  opening?: { eco: string; name: string } | null;
  /** What masters played in the position before the move: set on book moves and on the move that left the book. */
  theory?: TheoryInfo | null;
}

/** A master choice in a position, with the line masters most often follow after it. */
export interface TheoryOption extends MasterMove {
  san: string;
  /** UCI moves after it, following the most played move each time. */
  line: string[];
}

export interface TheoryInfo {
  /** Master games that reached the position before the move. */
  games: number;
  /** This move's master statistics (null when masters didn't play it as theory). */
  played: MasterMove | null;
  /** Master moves here, most played first. */
  options: TheoryOption[];
}

/** Evaluation of a game-over position (mate or draw), White-relative. */
export function terminalEval(fen: string): Evaluation | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { kind: "mate", moves: 0, winner: c.turn() === "w" ? "b" : "w" };
  if (c.isDraw() || c.isStalemate()) return { kind: "cp", cp: 0 };
  return null;
}

/** Lichess move accuracy from win% before/after (mover's view, 0–100). */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, winBefore - winAfter)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

function pointLossClass(prev: Evaluation, cur: Evaluation, mover: Color, loss: number): MoveClass {
  const curMover = evalFor(cur, mover);
  // Mate → mate
  if (prev.kind === "mate" && cur.kind === "mate") {
    const hadMate = prev.winner === mover;
    const hasMate = cur.winner === mover;
    if (hadMate && !hasMate) return cur.moves <= 3 ? "blunder" : "mistake";
    if (!hadMate) return "best"; // being mated either way: delaying it is all you can do
    const delay = cur.moves - (prev.moves - 1);
    if (delay <= 0) return "best";
    if (delay < 2) return "excellent";
    if (delay < 7) return "good";
    return "inaccuracy";
  }
  // Mate → centipawns: a forced mate was let go
  if (prev.kind === "mate" && cur.kind === "cp") {
    if (prev.winner !== mover) return "best"; // escaping a mate threat
    if (curMover >= 800) return "excellent";
    if (curMover >= 400) return "good";
    if (curMover >= 200) return "inaccuracy";
    if (curMover >= 0) return "mistake";
    return "blunder";
  }
  // Centipawns → mate
  if (prev.kind === "cp" && cur.kind === "mate") {
    if (cur.winner === mover) return "best";
    if (cur.moves <= 2) return "blunder";
    if (cur.moves <= 5) return "mistake";
    return "inaccuracy";
  }
  if (loss < 0.005) return "best";
  if (loss < 0.02) return "excellent";
  if (loss < 0.05) return "good";
  if (loss < 0.1) return "inaccuracy";
  if (loss < 0.2) return "mistake";
  return "blunder";
}

const RANK: Record<MoveClass, number> = {
  brilliant: 9,
  great: 8,
  best: 7,
  excellent: 6,
  good: 5,
  book: 6,
  forced: 7,
  inaccuracy: 3,
  mistake: 2,
  miss: 2,
  blunder: 1,
};

/** Class from the evaluation alone (best line vs played line), mover's view. */
export function lossClass(best: Evaluation, played: Evaluation, mover: Color): MoveClass {
  return pointLossClass(best, played, mover, Math.max(0, expectedScore(best, mover) - expectedScore(played, mover)));
}

export const isBad = (c: MoveClass) => c === "inaccuracy" || c === "mistake" || c === "blunder" || c === "miss";
export const classRank = (c: MoveClass) => RANK[c];

export interface ClassifyInput {
  move: GameMove;
  before: PositionAnalysis;
  after: PositionAnalysis;
  legalMoves: number;
  inBook: boolean;
  /** The previous move (the opponent's), already classified. */
  previous?: ClassifiedMove;
  opening?: { eco: string; name: string } | null;
  theory?: TheoryInfo | null;
}

/** Classifies one move. Pure: everything comes from the two position analyses. */
export function classifyMove(inp: ClassifyInput): ClassifiedMove {
  const { move, before, after } = inp;
  const mover = move.color;
  const best = before.lines[0] ?? null;
  const second = before.lines[1] ?? null;
  const evalBefore = before.eval;
  const evalAfter = after.eval;
  const epBefore = expectedScore(evalBefore, mover);
  const epAfter = expectedScore(evalAfter, mover);
  const loss = Math.max(0, epBefore - epAfter);
  const accuracy = moveAccuracy(epBefore * 100, epAfter * 100);
  const bestUci = best?.pv[0] ?? null;
  let bestSan: string | null = null;
  if (bestUci) {
    try {
      bestSan = new Chess(move.fenBefore).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san;
    } catch {
      bestSan = null;
    }
  }
  const base = {
    move,
    loss,
    before: epBefore,
    after: epAfter,
    accuracy,
    bestUci,
    bestSan,
    bestLine: best,
    secondLine: second,
    replyLine: after.lines[0] ?? null,
    evalBefore,
    evalAfter,
    sacrifice: null as SacrificeInfo | null,
    opening: inp.opening ?? null,
    theory: inp.theory ?? null,
  };

  if (inp.legalMoves <= 1) return { ...base, cls: "forced" };
  if (inp.inBook) return { ...base, cls: "book" };
  if (move.isMate) return { ...base, cls: "best" };

  const topPlayed = bestUci === move.uci;
  let cls: MoveClass = topPlayed ? "best" : pointLossClass(evalBefore, evalAfter, mover, loss);

  // Great / Brilliant candidates: not easy, not forced, not already decided.
  const secondEp = second ? expectedScore(second.eval, mover) : null;
  const stillWinningAnyway = secondEp !== null ? secondEp >= 0.93 : epAfter >= 0.93;
  const inCheckBefore = new Chess(move.fenBefore).inCheck();
  const candidate = !stillWinningAnyway && epAfter >= 0.45 && !inCheckBefore && move.promotion !== "q";
  const nearBest = topPlayed || loss < 0.02;

  if (candidate && topPlayed && !(evalAfter.kind === "mate" && evalAfter.winner === mover)) {
    const capturedFree = move.captured ? wasFreeMaterial(move.fenBefore, captureSquare(move)) : false;
    if (!capturedFree && secondEp !== null && epBefore - secondEp >= 0.1) cls = "great";
  }

  const prev = inp.previous;
  let sacrifice: SacrificeInfo | null = null;
  if (candidate && nearBest) {
    // Pieces the opponent could already take on their last turn were offered (and declined) before this move.
    const declined = prev ? unsafePieces(prev.move.fenBefore, mover) : [];
    sacrifice = detectSacrifice(move.fenBefore, move.uci, declined);
    // Brilliant: the sacrifice is the engine's choice and clearly better than not making it
    // (a liquidation that any move would match, e.g. into a dead draw, isn't brilliant).
    const needed = topPlayed && (secondEp === null || epBefore - secondEp >= BRILLIANT_GAP);
    if (sacrifice?.pieces.length && needed) cls = "brilliant";
  }

  // Miss: the opponent just erred, and this move lets the chance go without making things worse than before.
  if (prev && isBad(cls) && cls !== "inaccuracy" && (prev.cls === "mistake" || prev.cls === "blunder" || prev.cls === "miss")) {
    const beforeTheirMistake = 1 - prev.before; // our expected score before their move
    if (epAfter >= beforeTheirMistake - 0.02) return { ...base, cls: "miss", missedPly: prev.move.ply, sacrifice };
  }

  return { ...base, cls, sacrifice };
}

interface LineLike {
  pv: string[];
  eval: Evaluation;
  depth: number;
}

/**
 * Labels one candidate move in a single position (no game around it), with the
 * same rules as game review. `played` is the engine's line starting with the move,
 * `best`/`second` the top two lines of the position.
 */
export function classifyCandidate(fen: string, played: LineLike, best: LineLike, second?: LineLike | null): ClassifiedMove | null {
  const chess = new Chess(fen);
  const uci = played.pv[0];
  if (!uci) return null;
  let m;
  try {
    m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
  const move: GameMove = {
    ply: 1,
    san: m.san,
    uci: m.lan,
    from: m.from,
    to: m.to,
    color: m.color,
    piece: m.piece,
    captured: m.captured,
    promotion: m.promotion,
    fenBefore: fen,
    fenAfter: m.after,
    moveNumber: Number(fen.split(" ")[5]) || 1,
    isCheck: m.san.includes("+") || m.san.includes("#"),
    isMate: m.san.includes("#"),
  };
  const asLine = (l: LineLike, k: number): EngineLine => ({ multipv: k, depth: l.depth, eval: l.eval, pv: l.pv });
  const lines = [asLine(best, 1), ...(second ? [asLine(second, 2)] : [])];
  return classifyMove({
    move,
    before: { lines, eval: best.eval, depth: best.depth },
    after: { lines: played.pv.length > 1 ? [asLine({ ...played, pv: played.pv.slice(1) }, 1)] : [], eval: played.eval, depth: played.depth },
    legalMoves: new Chess(fen).moves().length,
    inBook: false,
  });
}

function captureSquare(m: GameMove) {
  if (m.piece === "p" && m.captured && m.from[0] !== m.to[0]) {
    const p = new Chess(m.fenBefore).get(m.to);
    if (!p) return `${m.to[0]}${m.from[1]}` as GameMove["to"]; // en passant
  }
  return m.to;
}
