/** Tells the story of an engine line: trades, material won, promotions and mates. */
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, type Color } from "../chess/types";
import { formatEval, type Evaluation } from "../engine/score";
import { materialSummary } from "../facts/material";
import { buildVariation, type VariationMove } from "../variation";
import { materialWords } from "./ideas";
import type { LineStory } from "./types";

export function scoreSheet(moves: VariationMove[]): string {
  return moves.map((m, i) => (m.color === "w" ? `${m.moveNumber}.${m.san}` : i === 0 ? `${m.moveNumber}…${m.san}` : m.san)).join(" ");
}

/**
 * @param baseFen where material is counted from (default `fen`): pass the position
 *   before the move being explained, so a capture by that move counts.
 */
export function narrate(fen: string, pv: string[], e: Evaluation, mover: Color, maxPlies = 12, baseFen?: string): LineStory | undefined {
  const v = buildVariation(fen, pv, maxPlies);
  if (!v.moves.length) return undefined;
  // Show about six plies, extended so the line doesn't stop in the middle of an exchange.
  let end = Math.min(v.moves.length, 6);
  while (end < v.moves.length && (v.moves[end - 1].captured || v.moves[end]?.captured)) end++;
  const moves = v.moves.slice(0, end);
  const settled = !moves[moves.length - 1].captured || end === v.moves.length;
  const events: string[] = [];
  for (let i = 0; i < moves.length; i++) {
    const a = moves[i];
    const b = moves[i + 1];
    if (a.captured && b?.captured && b.to === a.to && a.captured === b.captured) {
      if (a.captured !== "p") events.push(a.captured === "q" ? "the queens come off" : `the ${PIECE_NAME[a.captured]}s are traded`);
      i++;
      continue;
    }
    if (a.promotion) events.push(`the pawn promotes on ${a.to}`);
  }
  const mate = moves[moves.length - 1].san.includes("#");
  if (mate) events.push("it's mate");
  else if (settled) {
    const start = materialSummary(placementFromFen(baseFen ?? fen)).diff;
    const endDiff = materialSummary(placementFromFen(moves[moves.length - 1].fenAfter)).diff - start;
    const forMover = mover === "w" ? endDiff : -endDiff;
    if (forMover >= 1) events.push(`${COLOR_NAME[mover]} comes out ${materialWords(forMover)} up`);
    else if (forMover <= -1) events.push(`${COLOR_NAME[mover]} is ${materialWords(forMover)} down`);
  }
  const sheet = scoreSheet(moves);
  const list = [...new Set(events)];
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
  const text = list.length ? `After ${sheet}, ${joined} (${formatEval(e)}).` : `Engine line: ${sheet} (${formatEval(e)}).`;
  return { moves: sheet, text, eval: e };
}
