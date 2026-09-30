/**
 * Move explanations built from before/after board facts and the engine line.
 * Each point says where its evidence comes from; nothing here invents moves —
 * every move mentioned was replayed through chess.js.
 */
import { Chess } from "chess.js";
import { ALL_SQUARES, attackersOf, attacksFrom, fileIndex, rankIndex } from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, other, type Color, type Placement, type Square } from "../chess/types";
import { describeEval, evalFor, evalLoss, formatEval, type Evaluation } from "../engine/score";
import { buildVariation, type VariationMove } from "../variation";
import { safeMobility, isOutpost, fileState } from "./activity";
import { enPrise, makeCtx, the, value as pieceValue } from "./context";
import { kingZone } from "./king";
import { materialSummary } from "./material";
import { classifyPawns } from "./pawns";
import { emptyMarks, type Evidence, type Marks, type Tone } from "./types";

export interface InsightPoint {
  text: string;
  tone: Tone;
  evidence: Evidence;
  marks: Marks;
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

const enPriseSet = (fen: string, color: Color): Square[] => {
  const ctx = makeCtx(fen);
  return ALL_SQUARES.filter((s) => ctx.p[s]?.color === color && enPrise(ctx, s));
};

/** Static, board-only reasons a move matters. Engine context is added by callers. */
export function staticMovePoints(move: VariationMove): InsightPoint[] {
  const pts: InsightPoint[] = [];
  const before = placementFromFen(move.fenBefore);
  const after = placementFromFen(move.fenAfter);
  const me = move.color;
  const them = other(me);
  const name = PIECE_NAME[move.piece];

  if (move.san.includes("#")) {
    pts.push(point("Checkmate.", "opportunity", "rules", { squares: [{ sq: move.to, tone: "opportunity", style: "fill" }] }));
    return pts;
  }
  if (move.captured) {
    pts.push(
      point(`Takes the ${PIECE_NAME[move.captured]} on ${move.to}.`, "opportunity", "rules", {
        squares: [{ sq: move.to, tone: "opportunity", style: "ring" }],
      }),
    );
  }
  if (move.isCheck) {
    const replies = new Chess(move.fenAfter).moves().length;
    pts.push(
      point(
        replies <= 3 ? `Check, leaving only ${replies} legal repl${replies === 1 ? "y" : "ies"}.` : "Gives check, so the reply is forced to deal with it.",
        "opportunity",
        "rules",
      ),
    );
  }
  if (move.isCastle) {
    pts.push(point("Castles: the king steps away from the centre and a rook joins the game.", "opportunity", "rules"));
  }
  if (move.promotion) pts.push(point(`Promotes to a ${PIECE_NAME[move.promotion]}.`, "opportunity", "rules"));

  // New targets: enemy pieces that are en prise only after this move
  const targetsBefore = new Set(enPriseSet(move.fenBefore, them));
  const afterCtx = makeCtx(move.fenAfter);
  // After the move it's the opponent's turn, so compute "if it were our move again" by static counting.
  const newTargets = ALL_SQUARES.filter((s) => {
    const x = after[s];
    if (!x || x.color !== them || x.type === "k" || targetsBefore.has(s)) return false;
    const atk = attackersOf(after, s, me);
    if (!atk.length) return false;
    const def = attackersOf(after, s, them);
    return !def.length || atk.some((a) => after[a]!.type !== "k" && valueAt(after, a) < valueAt(after, s));
  });
  for (const t of newTargets.slice(0, 2)) {
    const by = attackersOf(after, t, me);
    const direct = by.includes(move.to);
    const who = direct ? `The ${name}` : `${the(after, by[0])[0].toUpperCase()}${the(after, by[0]).slice(1)}`;
    pts.push(
      point(`${who} now ${direct ? "attacks" : "attacks (uncovered)"} ${the(after, t)}${attackersOf(after, t, them).length ? ", which is worth more" : ", which is undefended"}.`, "opportunity", "rules", {
        arrows: by.map((b) => ({ from: b, to: t, tone: "opportunity" as const })),
        squares: [{ sq: t, tone: "danger", style: "ring" }],
      }),
    );
  }

  // Own pieces rescued
  const riskBefore = enPriseSet(move.fenBefore, me);
  const riskAfterStatic = ALL_SQUARES.filter((s) => after[s]?.color === me && enPrise(afterCtx, s));
  if (riskBefore.includes(move.from) && !riskAfterStatic.includes(move.to)) {
    pts.push(point(`Moves the attacked ${name} to safety.`, "info", "rules", { arrows: [{ from: move.from, to: move.to, tone: "info" }] }));
  }
  for (const s of riskBefore.filter((x) => x !== move.from && !riskAfterStatic.includes(x)).slice(0, 1)) {
    pts.push(point(`Protects ${the(after, s)}, which was hanging.`, "info", "rules", { squares: [{ sq: s, tone: "info", style: "ring" }] }));
  }

  // Concessions: pieces newly en prise for the mover
  const newRisk = riskAfterStatic.filter((s) => !riskBefore.includes(s) || s === move.to);
  for (const s of newRisk.slice(0, 2)) {
    const takers = afterCtx.capturers(s, them);
    pts.push(
      point(
        s === move.to
          ? `The ${name} on ${s} can be taken by ${takers.map((t) => the(after, t)).join(" or ")}.`
          : `Leaves ${the(after, s)} en prise to ${takers.map((t) => the(after, t)).join(" or ")}.`,
        "danger",
        "rules",
        {
          squares: [{ sq: s, tone: "danger", style: "ring" }],
          arrows: takers.map((t) => ({ from: t, to: s, tone: "danger" as const })),
        },
      ),
    );
  }

  // Prophylaxis: enemy pieces that lose safe squares the moved piece now covers.
  if (!move.captured && !move.isCheck) {
    const covered = new Set(attacksOn(after, move.to));
    const robbed = new Map<Square, Square[]>();
    for (const sq of ALL_SQUARES) {
      const x = before[sq];
      if (!x || x.color !== them || x.type === "k" || x.type === "p" || !after[sq]) continue;
      const was = safeMobility(before, sq, attacksOn(before, sq));
      const now = new Set(safeMobility(after, sq, attacksOn(after, sq)));
      const lost = was.filter((t) => !now.has(t) && covered.has(t));
      if (lost.length) robbed.set(sq, lost);
    }
    const bySquare = new Map<Square, Square[]>();
    for (const [piece, lost] of robbed) for (const t of lost) bySquare.set(t, [...(bySquare.get(t) ?? []), piece]);
    const top = [...bySquare.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 2);
    for (const [t, pieces] of top) {
      pts.push(
        point(`Takes ${t} away from ${pieces.map((q) => the(before, q)).join(" and ")}.`, "opportunity", "rules", {
          squares: [{ sq: t, tone: "danger", style: "pit" }, ...pieces.map((q) => ({ sq: q, tone: "danger" as const, style: "ring" as const }))],
          arrows: [{ from: move.to, to: t, tone: "opportunity", thin: true }],
        }),
      );
    }
  }

  // Opening lines: own pieces (other than the mover) that gain safe squares.
  if (!move.isCastle) {
    const freed: { sq: Square; gain: number }[] = [];
    for (const sq of ALL_SQUARES) {
      const x = after[sq];
      if (!x || x.color !== me || sq === move.to || x.type === "k" || x.type === "p" || before[sq]?.type !== x.type) continue;
      const gain = safeMobility(after, sq, attacksOn(after, sq)).length - safeMobility(before, sq, attacksOn(before, sq)).length;
      if (gain >= 2) freed.push({ sq, gain });
    }
    for (const f of freed.sort((x, y) => y.gain - x.gain).slice(0, 1)) {
      pts.push(
        point(`Opens the way for ${the(after, f.sq)}: ${f.gain} more safe squares.`, "opportunity", "rules", {
          squares: [{ sq: f.sq, tone: "opportunity", style: "ring" }, { sq: move.from, tone: "opportunity", style: "dashed" }],
        }),
      );
    }
  }

  // Piece improvement
  if (["n", "b", "r", "q"].includes(move.piece) && !move.captured) {
    const bm = safeMobility(before, move.from, attacksOn(before, move.from)).length;
    const am = safeMobility(after, move.to, attacksOn(after, move.to)).length;
    if (am - bm >= 3) pts.push(point(`The ${name} goes from ${bm} to ${am} safe squares.`, "opportunity", "rules"));
    if ((move.piece === "n" || move.piece === "b") && isOutpost(after, move.to, me) && !isOutpost(before, move.from, me)) {
      pts.push(point(`Lands on an outpost that no ${COLOR_NAME[them]} pawn can challenge.`, "opportunity", "rules", {
        squares: [{ sq: move.to, tone: "opportunity", style: "fill" }],
      }));
    }
    if (move.piece === "r" && fileIndex(move.from) !== fileIndex(move.to)) {
      const st = fileState(after, fileIndex(move.to));
      if (!st.w && !st.b) pts.push(point(`The rook takes the open ${move.to[0]}-file.`, "opportunity", "rules"));
      else if (!st[me] && st[them]) pts.push(point(`The rook moves to the half-open ${move.to[0]}-file.`, "opportunity", "rules"));
    }
  }

  // Pawn structure changes for the mover
  if (move.piece === "p" || move.captured === "p") {
    const pb = classifyPawns(before).filter((x) => x.color === me);
    const pa = classifyPawns(after).filter((x) => x.color === me);
    const newPassed = pa.filter((x) => x.passed && !pb.some((y) => y.sq === x.sq && y.passed) && !(x.sq === move.to && pb.some((y) => y.sq === move.from && y.passed)));
    if (newPassed.length) pts.push(point(`Creates a passed pawn on ${newPassed[0].sq}.`, "opportunity", "rules", { squares: [{ sq: newPassed[0].sq, tone: "opportunity", style: "ring" }] }));
    const newIsolated = pa.filter((x) => x.isolated && !pb.some((y) => y.sq === x.sq && y.isolated) && x.sq !== move.to);
    if (newIsolated.length) pts.push(point(`Leaves the ${newIsolated[0].sq} pawn isolated.`, "danger", "rules", { squares: [{ sq: newIsolated[0].sq, tone: "danger", style: "ring" }] }));
  }
  if (move.piece === "p") {
    const hitsPawn = attacksOn(after, move.to).some((s) => after[s]?.type === "p" && after[s]?.color === them);
    if (hitsPawn && !move.captured) pts.push(point("Challenges an enemy pawn: a pawn break.", "opportunity", "rules"));
    const k = ALL_SQUARES.find((s) => before[s]?.type === "k" && before[s]?.color === me);
    if (k && kingZone(k).some((z) => fileIndex(z) === fileIndex(move.from)) && Math.abs(rankIndex(move.from) - rankIndex(k)) <= 1) {
      pts.push(point("Moves a pawn from in front of its own king, loosening the cover.", "danger", "rules", { squares: [{ sq: move.from, tone: "danger", style: "dashed" }] }));
    }
  }

  // Castling rights given up
  if (!move.isCastle && (move.piece === "k" || move.piece === "r")) {
    const rb = move.fenBefore.split(" ")[2];
    const ra = move.fenAfter.split(" ")[2];
    const side = me === "w" ? /[KQ]/g : /[kq]/g;
    if ((rb.match(side) ?? []).length > (ra.match(side) ?? []).length) {
      pts.push(point("Gives up castling rights.", "danger", "rules"));
    }
  }
  return pts;
}

function attacksOn(p: Placement, sq: Square) {
  return attacksFrom(p, sq);
}

function valueAt(p: Placement, sq: Square) {
  return p[sq] ? pieceValue(p[sq]!) : 0;
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
  return { move, loss, verdict, refutation, engine };
}

export function evalFromMoverView(e: Evaluation, mover: Color) {
  return evalFor(e, mover);
}
