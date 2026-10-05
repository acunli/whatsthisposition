/**
 * Is a plan good *now*? For the side to move, the plan's first move is searched on
 * its own and compared with the engine's best: good now, playable but second-best,
 * or refuted (with the reply that refutes it). The engine's main line tells when
 * the engine itself gets round to it.
 */
import { Chess } from "chess.js";
import { COLOR_NAME, other, type Color } from "../chess/types";
import type { Searcher } from "../deep/deep";
import { evalFor, formatEval, type Evaluation } from "../engine/score";
import { emptyMarks, type Marks } from "../facts/types";
import { gainWords, netCaptures } from "../reason/ideas";
import { moveLabel, type LineInput, type ThreatInfo } from "../reason/reason";
import { buildVariation } from "../variation";
import type { PlanCard } from "./cards";

export type PlanVerdict = "now" | "prepare" | "not-now" | "later";

export interface PlanTiming {
  verdict: PlanVerdict;
  /** One or two sentences: when and why. */
  text: string;
  /** Mover-relative cost of playing it now vs the best move, in centipawns. */
  cost?: number;
  eval?: Evaluation;
  /** The engine's line starting with the plan move (for "show it"). */
  pv?: string[];
  marks: Marks;
}

const mv = (e: Evaluation, c: Color) => Math.max(-3000, Math.min(3000, evalFor(e, c)));
const pawns = (cp: number) => (cp / 100).toFixed(1);

/** Where the plan move appears in the engine's main line, as "after 11.Qe3 Nf5". */
function inMainLine(fen: string, best: LineInput | undefined, uci: string): string | null {
  if (!best) return null;
  const v = buildVariation(fen, best.pv, 14);
  const i = v.moves.findIndex((m) => m.uci === uci || (m.isCastle && uci.slice(0, 2) === m.from && uci.slice(2) === m.to));
  if (i <= 0) return null;
  return v.moves
    .slice(0, i)
    .map((m, k) => (m.color === "w" ? `${m.moveNumber}.${m.san}` : k === 0 ? `${m.moveNumber}…${m.san}` : m.san))
    .join(" ");
}

export async function planTiming(fen: string, card: PlanCard, best: LineInput | undefined, search: Searcher, depth: number, threat: ThreatInfo | null): Promise<PlanTiming> {
  const turn = fen.split(" ")[1] as Color;
  const side = card.side;
  const name = card.keySan ?? card.title;
  if (side !== turn) {
    return { verdict: "later", text: `It's ${COLOR_NAME[turn]}'s move: this is an idea for ${COLOR_NAME[side]} after the reply.`, marks: emptyMarks() };
  }
  const legal = !!card.keyUci && new Chess(fen).moves({ verbose: true }).some((m) => m.lan === card.keyUci);
  const later = card.keyUci ? inMainLine(fen, best, card.keyUci) : null;
  if (!legal) {
    const unmet = card.conditions.filter((c) => !c.met).map((c) => c.text.charAt(0).toLowerCase() + c.text.slice(1));
    return {
      verdict: "prepare",
      text: `Not possible yet${unmet.length ? `: ${unmet.join("; ")}` : ""}.${later ? ` The engine gets there after ${later}.` : ""}`,
      marks: emptyMarks(),
    };
  }
  const line = (await search({ fen, depth, multipv: 1, searchmoves: [card.keyUci!] }))[0];
  if (!line || !best) return { verdict: "prepare", text: "The engine couldn't check this one.", marks: emptyMarks() };
  const cost = mv(best.eval, side) - mv(line.eval, side);
  const v = buildVariation(fen, line.pv, 8);
  const first = v.moves[0];
  const reply = v.moves[1];
  const bestFirst = buildVariation(fen, best.pv, 1).moves[0];
  const isBest = best.pv[0] === card.keyUci;
  if (cost <= 35) {
    return {
      verdict: "now",
      text: isBest ? `Good now: it's the engine's first choice (${formatEval(line.eval)}).` : `Good now: about as strong as the engine's ${bestFirst ? moveLabel(bestFirst) : "choice"} (${formatEval(line.eval)} against ${formatEval(best.eval)}).`,
      cost,
      eval: line.eval,
      pv: line.pv,
      marks: { ...emptyMarks(), arrows: first ? [{ from: first.from, to: first.to, tone: "opportunity" }] : [] },
    };
  }
  if (cost <= 120) {
    return {
      verdict: "prepare",
      text: `Playable, but ${bestFirst ? moveLabel(bestFirst) : "the engine's move"} comes first: playing ${name} right away costs about ${pawns(cost)} pawns.${later ? ` The engine plays it after ${later}.` : ""}`,
      cost,
      eval: line.eval,
      pv: line.pv,
      marks: { ...emptyMarks(), arrows: bestFirst ? [{ from: bestFirst.from, to: bestFirst.to, tone: "opportunity" }] : [] },
    };
  }
  // Refuted: say how.
  const net = netCaptures(fen, line.pv, other(side), 10, 4);
  const wins = net.swing >= 1 ? `, winning ${gainWords(net)}` : "";
  const ignoresThreat = !!threat && threat.uci === reply?.uci;
  const how = ignoresThreat
    ? `it ignores the threat ${threat!.label}${threat!.why ? `, ${threat!.why}` : ""}`
    : reply
      ? `after ${name}, ${COLOR_NAME[other(side)]} answers ${moveLabel(reply)}${wins}`
      : `it costs about ${pawns(cost)} pawns`;
  return {
    verdict: "not-now",
    text: `Not now: ${how} (${formatEval(line.eval)} against ${formatEval(best.eval)}).${later ? ` The engine plays it after ${later}.` : ""}`,
    cost,
    eval: line.eval,
    pv: line.pv,
    marks: { ...emptyMarks(), arrows: [...(first ? [{ from: first.from, to: first.to, tone: "danger" as const, dashed: true }] : []), ...(reply ? [{ from: reply.from, to: reply.to, tone: "danger" as const }] : [])] },
  };
}
