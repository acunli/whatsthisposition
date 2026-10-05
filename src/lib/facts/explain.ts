/**
 * Move explanations built from before/after board facts and the engine line.
 * Each point says where its evidence comes from; nothing here invents moves —
 * every move mentioned was replayed through chess.js.
 */
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, type Color } from "../chess/types";
import { describeEval, evalFor, evalLoss, formatEval, type Evaluation } from "../engine/score";
import { boardIdeas } from "../reason/ideas";
import { buildVariation, type VariationMove } from "../variation";
import { materialSummary } from "./material";
import { emptyMarks, type Evidence, type Marks, type PeekLine, type Tone } from "./types";

export interface InsightPoint {
  text: string;
  tone: Tone;
  evidence: Evidence;
  marks: Marks;
  /** Lines the sentence names, for the hover preview. */
  line?: PeekLine;
  lines?: PeekLine[];
}

export interface MoveInsight {
  san: string;
  uci: string;
  color: Color;
  points: InsightPoint[];
}

function point(text: string, tone: Tone, evidence: Evidence, partial: Partial<Marks> = {}): InsightPoint {
  return { text, tone, evidence, marks: { ...emptyMarks(), ...partial } };
}

/**
 * Board-only reasons a move matters, without an engine line: the same detectors as
 * the move-reasoning engine (lib/reason/ideas.ts). Captures are stated plainly,
 * because without the line we can't tell a win from a trade.
 */
export function staticMovePoints(move: VariationMove): InsightPoint[] {
  const ideas = boardIdeas(move, { after: [], evalAfter: 0 });
  const pts: InsightPoint[] = [];
  if (move.captured && !move.san.includes("#")) {
    pts.push(point(`Takes the ${PIECE_NAME[move.captured]} on ${move.to}.`, "opportunity", "rules", { squares: [{ sq: move.to, tone: "opportunity", style: "ring" }] }));
  }
  for (const i of ideas) {
    if (i.kind === "material" || i.kind === "trade") continue;
    pts.push({ text: i.text, tone: i.tone, evidence: i.evidence === "engine" ? "rules" : i.evidence, marks: i.marks });
  }
  return pts;
}

/** Material swing along a line, from the mover's point of view, once captures settle. */
export function materialSwing(startFen: string, pv: string[], mover: Color, maxPlies = 8): { swing: number; plies: number } {
  const v = buildVariation(startFen, pv, maxPlies);
  const start = materialSummary(placementFromFen(startFen)).diff;
  // Stop after a quiet move pair so we don't count a capture that gets recaptured next ply.
  let end = v.moves.length;
  for (let i = 1; i < v.moves.length; i++) {
    if (!v.moves[i].captured && !v.moves[i - 1].captured && i >= 2) {
      end = i;
      break;
    }
  }
  const fen = end === 0 ? startFen : v.moves[end - 1].fenAfter;
  const diff = materialSummary(placementFromFen(fen)).diff - start;
  return { swing: mover === "w" ? diff : -diff, plies: end };
}

export interface LineContext {
  /** Full engine line starting with this move. */
  pv: string[];
  eval: Evaluation;
  depth: number;
}

export interface WhyThis {
  move: MoveInsight;
  reply?: MoveInsight;
  engine: InsightPoint[];
}

export function explainMove(fen: string, line: LineContext): WhyThis | null {
  const v = buildVariation(fen, line.pv, 12);
  const first = v.moves[0];
  if (!first) return null;
  const engine: InsightPoint[] = [];
  const verdict = describeEval(line.eval);
  engine.push(point(`After this line the engine says: ${verdict.headline.toLowerCase()} (${formatEval(line.eval)}, depth ${line.depth}).`, "info", "engine"));
  const { swing, plies } = materialSwing(fen, line.pv, first.color);
  if (swing !== 0 && plies > 0) {
    engine.push(
      point(
        swing > 0
          ? `Over the next ${plies} moves of the line, ${COLOR_NAME[first.color]} comes out ${swing} point${swing > 1 ? "s" : ""} of material ahead.`
          : `It gives up ${-swing} point${swing < -1 ? "s" : ""} of material over the next ${plies} moves. The engine judges the compensation worth it.`,
        swing > 0 ? "opportunity" : "idea",
        "engine",
      ),
    );
  }
  const move: MoveInsight = { san: first.san, uci: first.uci, color: first.color, points: staticMovePoints(first) };
  if (!move.points.length) {
    move.points.push(point("A quiet move. Its point shows up later in the line: step through it.", "info", "engine"));
  }
  const second = v.moves[1];
  const reply = second
    ? { san: second.san, uci: second.uci, color: second.color, points: staticMovePoints(second).slice(0, 3) }
    : undefined;
  return { move, reply, engine };
}

export interface WhyNot {
  move: MoveInsight;
  loss: number;
  bestEval: Evaluation;
  candidateEval: Evaluation;
  verdict: string;
  refutation?: MoveInsight;
  engine: InsightPoint[];
}

/**
 * Explains why `candidate` is worse than `best`. `candidateLine` must be the
 * engine's line for the candidate (searched with `searchmoves`).
 */
export function explainWhyNot(fen: string, best: LineContext, candidateLine: LineContext): WhyNot | null {
  const v = buildVariation(fen, candidateLine.pv, 12);
  const first = v.moves[0];
  if (!first) return null;
  const bestSan = buildVariation(fen, best.pv.slice(0, 1)).moves[0]?.san ?? best.pv[0];
  const mover = first.color;
  const loss = evalLoss(best.eval, candidateLine.eval, mover);
  const engine: InsightPoint[] = [];
  let verdict: string;
  const bestMate = best.eval.kind === "mate" && best.eval.winner === mover;
  const allowsMate = candidateLine.eval.kind === "mate" && candidateLine.eval.winner !== mover;
  if (allowsMate && candidateLine.eval.kind === "mate") {
    verdict = `Allows mate in ${candidateLine.eval.moves}.`;
  } else if (bestMate && !(candidateLine.eval.kind === "mate" && candidateLine.eval.winner === mover) && best.eval.kind === "mate") {
    verdict = `Misses a forced mate in ${best.eval.moves} with ${bestSan}.`;
  } else if (loss < 30) {
    verdict = `About as good as ${bestSan}: the engine sees almost no difference.`;
  } else {
    verdict = `Costs about ${(loss / 100).toFixed(1)} pawns compared with ${bestSan}.`;
  }
  engine.push(point(`${verdict} (${formatEval(candidateLine.eval)} vs ${formatEval(best.eval)}, depth ${candidateLine.depth}).`, loss >= 30 || allowsMate ? "danger" : "info", "engine"));

  const reply = v.moves[1];
  if (reply) {
    const { swing, plies } = materialSwing(first.fenAfter, candidateLine.pv.slice(1), reply.color);
    if (swing > 0) {
      engine.push(point(`After ${reply.san}, ${COLOR_NAME[reply.color]} wins ${swing} point${swing > 1 ? "s" : ""} of material within ${plies} moves.`, "danger", "engine"));
    }
  }
  const move: MoveInsight = { san: first.san, uci: first.uci, color: mover, points: staticMovePoints(first) };
  const refutation = reply
    ? { san: reply.san, uci: reply.uci, color: reply.color, points: staticMovePoints(reply).slice(0, 3) }
    : undefined;
  return { move, loss, bestEval: best.eval, candidateEval: candidateLine.eval, verdict, refutation, engine };
}

export function evalFromMoverView(e: Evaluation, mover: Color) {
  return evalFor(e, mover);
}
