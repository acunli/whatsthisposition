/**
 * Short, board-anchored explanations for every reviewed move, built from that
 * move's own engine lines and board facts. No game-specific logic: the same
 * templates explain any game.
 */
import { COLOR_NAME, PIECE_NAME, other, type Color, type Square } from "../chess/types";
import { formatEval, type Evaluation } from "../engine/score";
import { explainWhyNot, staticMovePoints, type InsightPoint } from "../facts/explain";
import { emptyMarks, type Marks } from "../facts/types";
import { buildVariation, type VariationMove } from "../variation";
import { CLASS_INFO, expectedScore, type ClassifiedMove } from "./classify";

export interface MoveStory {
  headline: string;
  points: InsightPoint[];
  /** The engine's preferred line from the position before the move (if different from the game). */
  better?: { san: string; pv: string[]; marks: Marks };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const numbered = (m: { moveNumber: number; color: Color; san: string }) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const VERB = /^(Takes|Protects|Moves|Gives|Uncovers|Opens|Attacks|Forks|Pins|Skewers|Threatens|Puts|Leaves|Blocks|Defends|Creates|Wins|Removes|Brings|Trades|Pushes|Castles|Develops|Controls|Frees|Stops|Prevents|Promotes|Centralises|Doubles)\b/;

/** "White answers 5.Qxf3, which takes the bishop on f3." / "…: the pawn now attacks …". */
function because(lead: string, text: string) {
  const t = text.replace(/\.$/, "");
  return VERB.test(t) ? `${lead}, which ${lower(t)}.` : `${lead}: ${lower(t)}.`;
}

function point(text: string, tone: InsightPoint["tone"], evidence: InsightPoint["evidence"], marks: Partial<Marks> = {}): InsightPoint {
  return { text, tone, evidence, marks: { ...emptyMarks(), ...marks } };
}

/** "24…cxd4 25.Qxd4+ Qb6 26.Re7+": move numbers as written on a score sheet. */
export function lineText(fen: string, pv: string[], n = 4) {
  return buildVariation(fen, pv, n)
    .moves.map((m, i) => (m.color === "w" ? `${m.moveNumber}.${m.san}` : i === 0 ? `${m.moveNumber}…${m.san}` : m.san))
    .join(" ");
}

/** Where things stand, from the mover's point of view. */
function standing(e: Evaluation, me: Color) {
  if (e.kind === "mate") return e.winner === me ? `${COLOR_NAME[me]} mates in ${e.moves}` : `${COLOR_NAME[other(me)]} mates in ${e.moves}`;
  return `the engine rates it ${formatEval(e)}`;
}

const arrow = (m: VariationMove, tone: "danger" | "opportunity" | "info", dashed = false) => ({ from: m.from, to: m.to, tone, dashed });

export function explainReviewMove(c: ClassifiedMove, prev?: ClassifiedMove): MoveStory {
  const m = c.move;
  const me = m.color;
  const them = other(me);
  const statics = staticMovePoints({ ...m, isCastle: m.san.startsWith("O-O") });
  const good = statics.filter((p) => p.tone !== "danger");
  const better =
    c.bestUci && c.bestUci !== m.uci && c.bestLine && c.bestSan
      ? {
          san: c.bestSan,
          pv: c.bestLine.pv,
          marks: { ...emptyMarks(), arrows: [{ from: c.bestUci.slice(0, 2) as Square, to: c.bestUci.slice(2, 4) as Square, tone: "opportunity" as const }] },
        }
      : undefined;
  const replyLine = c.replyLine;
  const replyV = replyLine ? buildVariation(m.fenAfter, replyLine.pv, 6) : null;
  const reply = replyV?.moves[0];
  const replyEnd = replyV?.moves[Math.min(replyV.moves.length, 4) - 1];
  const points: InsightPoint[] = [];

  switch (c.cls) {
    case "book":
      return {
        headline: c.opening ? `${numbered(m)} is opening theory: ${c.opening.name} (${c.opening.eco}).` : `${numbered(m)} is a well-known opening move.`,
        points: good.slice(0, 2),
      };

    case "forced":
      return { headline: `${numbered(m)} was the only legal move.`, points: [] };

    case "brilliant": {
      const pieces = c.sacrifice?.pieces ?? [];
      const names = pieces.map((p) => `the ${PIECE_NAME[p.type]} on ${p.square}`).join(" and ");
      const moved = pieces.some((p) => p.square === m.to);
      points.push(
        point(moved ? `Puts ${names} where it can be taken.` : `Leaves ${names} where it can be taken.`, "opportunity", "rules", {
          squares: pieces.map((p) => ({ sq: p.square, tone: "opportunity" as const, style: "pulse" as const })),
        }),
      );
      if (reply && replyLine) {
        const takes = !!reply.captured && pieces.some((p) => p.square === reply.to);
        const line = lineText(m.fenAfter, replyLine.pv);
        const mates = replyEnd?.san.includes("#");
        points.push(
          point(
            takes
              ? `${COLOR_NAME[them]} can take, but after ${line} ${mates ? "it's checkmate" : standing(c.evalAfter, me)}.`
              : `Taking is too dangerous: ${COLOR_NAME[them]}'s best reply is ${line} instead (${standing(c.evalAfter, me)}).`,
            "opportunity",
            "engine",
            { arrows: [arrow(reply, "danger")] },
          ),
        );
      }
      points.push(...good.slice(0, 2));
      return { headline: `${numbered(m)}!! A real sacrifice: ${COLOR_NAME[me]} gives up material and the engine still rates it best.`, points };
    }

    case "great": {
      const second = c.secondLine ? buildVariation(m.fenBefore, c.secondLine.pv, 1).moves[0] : undefined;
      points.push(...good.slice(0, 2));
      if (second && c.secondLine)
        points.push(
          point(
            `The next best move, ${numbered(second)}, would drop ${COLOR_NAME[me]}'s winning chances from ${pct(c.before)} to ${pct(expectedScore(c.secondLine.eval, me))} (${formatEval(c.secondLine.eval)}).`,
            "info",
            "engine",
            { arrows: [arrow(second, "danger", true)] },
          ),
        );
      return { headline: `${numbered(m)}! The only good move here: every alternative is clearly worse.`, points };
    }

    case "best":
    case "excellent":
    case "good": {
      points.push(...good.slice(0, 2));
      if (!points.length) points.push(point("A quiet move: its point shows up in the engine's line below.", "info", "engine"));
      if (reply && replyLine) points.push(point(`Engine line: ${lineText(m.fenAfter, replyLine.pv)} (${formatEval(replyLine.eval)}).`, "info", "engine", { arrows: [arrow(reply, "info", true)] }));
      const head =
        c.cls === "best"
          ? `${numbered(m)} is the engine's top choice.`
          : `${numbered(m)} is ${CLASS_INFO[c.cls].label.toLowerCase()}: ${COLOR_NAME[me]} keeps ${pct(c.after)} winning chances${c.bestSan ? ` (best was ${c.bestSan}, ${pct(c.before)})` : ""}.`;
      return { headline: head, points, better: c.cls === "best" ? undefined : better };
    }

    case "inaccuracy":
    case "mistake":
    case "blunder":
    case "miss": {
      if (c.bestLine && replyLine) {
        const wn = explainWhyNot(m.fenBefore, { pv: c.bestLine.pv, eval: c.bestLine.eval, depth: c.bestLine.depth }, { pv: [m.uci, ...replyLine.pv], eval: c.evalAfter, depth: replyLine.depth });
        if (wn) {
          const ref = wn.refutation;
          const refPoint = ref?.points.find((p) => p.tone === "opportunity") ?? ref?.points[0];
          if (ref && reply) {
            points.push(
              refPoint
                ? { ...refPoint, text: because(`${COLOR_NAME[them]} answers ${numbered(reply)}`, refPoint.text), tone: "danger", evidence: "engine" }
                : point(`${COLOR_NAME[them]} answers ${numbered(reply)}.`, "danger", "engine", { arrows: [arrow(reply, "danger")] }),
            );
          }
          points.push(...wn.move.points.filter((p) => p.tone === "danger").slice(0, 1));
          points.push(...wn.engine.slice(1));
        }
      }
      if (better) {
        const bm = buildVariation(m.fenBefore, better.pv, 1).moves[0];
        const bp = bm ? staticMovePoints(bm).find((p) => p.tone !== "danger") : undefined;
        const lead = `Better was ${bm ? numbered(bm) : better.san} (${formatEval(c.evalBefore)})`;
        points.push(point(bp ? because(lead, bp.text) : `${lead}.`, "opportunity", "engine", better.marks));
      }
      const drop = `${COLOR_NAME[me]}'s winning chances go from ${pct(c.before)} to ${pct(c.after)}`;
      if (c.cls === "miss" && prev) {
        return { headline: `${numbered(m)} misses the chance ${numbered(prev.move)} gave: ${c.bestSan ?? "the best move"} would have punished it. ${drop}.`, points, better };
      }
      const what = c.cls === "blunder" ? "a blunder" : c.cls === "mistake" ? "a mistake" : "an inaccuracy";
      const mated = c.evalAfter.kind === "mate" && c.evalAfter.winner === them ? ` It allows mate in ${c.evalAfter.moves}.` : "";
      return { headline: `${numbered(m)} is ${what}: ${drop}.${mated}`, points, better };
    }
  }
}
