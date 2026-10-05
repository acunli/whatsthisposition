/**
 * Short, board-anchored explanations for every reviewed move, built from that
 * move's own engine lines and board facts. No game-specific logic: the same
 * templates explain any game.
 */
import { COLOR_NAME, PIECE_NAME, other, type Color, type Square } from "../chess/types";
import { formatEval, type Evaluation } from "../engine/score";
import { explainWhyNot, staticMovePoints, type InsightPoint } from "../facts/explain";
import { emptyMarks, type Marks, type PeekLine } from "../facts/types";
import { buildVariation, type VariationMove } from "../variation";
import { CLASS_INFO, expectedScore, type ClassifiedMove, type TheoryInfo } from "./classify";
import type { GameReview } from "./review";

export interface MoveStory {
  headline: string;
  points: InsightPoint[];
  /** Opening theory: for book moves, what strong players do here; for the move that left the book, what they play instead. */
  opening?: InsightPoint[];
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

function point(text: string, tone: InsightPoint["tone"], evidence: InsightPoint["evidence"], marks: Partial<Marks> = {}, line?: PeekLine): InsightPoint {
  return { text, tone, evidence, marks: { ...emptyMarks(), ...marks }, ...(line ? { line } : {}) };
}

/** The line as written, with its hover preview. */
function peekLine(fen: string, pv: string[], n = 4): { text: string; line: PeekLine } {
  const text = lineText(fen, pv, n);
  return { text, line: { fen, pv, label: text } };
}

/** Who the book's statistics come from (scripts/build-book.mjs). */
const SOURCES = "Strong players";
const games = (n: number) => `${n.toLocaleString("en-US")} game${n === 1 ? "" : "s"}`;
const share = (count: number, total: number) => {
  const p = (100 * count) / total;
  return p >= 1 ? `${Math.round(p)}%` : "under 1%";
};

/** "White scores 54%" (draws counted as half), from the mover's side. */
function scores(o: { white: number; draw: number; black: number }, me: Color) {
  const s = (me === "w" ? o.white : o.black) + o.draw / 2;
  return `${COLOR_NAME[me]} scores ${Math.round(s)}%`;
}

/**
 * What strong players play in a position: "10.e3 (55%), 10.Qc2 (18%) or 10.Nd2 (14%)",
 * each move hoverable to show the line they usually follow after it.
 */
export function theoryChoices(fen: string, t: TheoryInfo, skip?: string, max = 3): { text: string; lines: PeekLine[] } {
  const opts = t.options.filter((o) => o.uci !== skip).slice(0, max);
  const lines: PeekLine[] = [];
  const parts = opts.map((o) => {
    const label = lineText(fen, [o.uci], 1);
    lines.push({ fen, pv: [o.uci, ...o.line], label });
    return `${label} (${share(o.count, t.games)})`;
  });
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : (parts[0] ?? "");
  return { text, lines };
}

/** The opening story of a book move: how often strong players choose it, what follows, what else is played. */
function bookPoints(c: ClassifiedMove): InsightPoint[] {
  const m = c.move;
  const t = c.theory;
  const out: InsightPoint[] = [];
  if (!t) return out;
  const mine = t.options.find((o) => o.uci === m.uci);
  if (t.played) {
    const often = share(t.played.count, t.games);
    out.push(
      point(
        `${SOURCES} reached this position in ${games(t.games)} and chose ${numbered(m)} in ${often} of them; ${scores(t.played, m.color)} after it (${t.played.draw}% draws).`,
        "info",
        "rules",
      ),
    );
  }
  if (mine?.line.length) {
    const next = peekLine(m.fenAfter, mine.line, 6);
    out.push(point(`The main line goes on ${next.text}.`, "info", "rules", {}, next.line));
  }
  const others = theoryChoices(m.fenBefore, t, m.uci);
  if (others.lines.length) out.push({ ...point(`Other choices here: ${others.text}.`, "info", "rules"), lines: others.lines });
  return out;
}

export interface OpeningStory {
  name: string | null;
  eco: string | null;
  points: InsightPoint[];
  /** Ply of the move that left the book (1-based, as the move list counts), if the game left it. */
  leftPly: number | null;
}

/**
 * The opening as a whole: how long both sides followed theory, who left it and with
 * what, what strong players play there instead, and how theory goes on.
 */
export function explainOpening(r: GameReview): OpeningStory | null {
  const last = r.bookUntil >= 0 ? r.moves[r.bookUntil] : undefined;
  const left = r.moves[r.bookUntil + 1];
  if (!last && !left?.theory) return null;
  const points: InsightPoint[] = [];
  if (last) {
    const plies = r.bookUntil + 1;
    points.push(
      point(
        `Both sides followed opening theory up to ${numbered(last.move)}: ${plies} ${plies === 1 ? "move" : "moves"} in all${plies >= 2 ? `, ${Math.ceil(plies / 2)} by White and ${Math.floor(plies / 2)} by Black` : ""}.`,
        "info",
        "rules",
      ),
    );
  }
  if (left) {
    const who = COLOR_NAME[left.move.color];
    const t = left.theory;
    if (t?.options.length) {
      const choices = theoryChoices(left.move.fenBefore, t, left.move.uci, 4);
      const rare = t.played ? `, a rare choice here (${share(t.played.count, t.games)})` : "";
      points.push({
        ...point(`${who} left the book with ${numbered(left.move)}${rare}. In ${games(t.games)} from this position, ${SOURCES.toLowerCase()} played ${choices.text}.`, "info", "rules"),
        lines: choices.lines,
      });
      const top = t.options[0];
      if (top.line.length) {
        const main = peekLine(left.move.fenBefore, [top.uci, ...top.line], 10);
        points.push(point(`The main line goes on ${main.text}.`, "info", "rules", {}, main.line));
      }
      // Results from this position, over the moves listed (they cover nearly all games).
      const n = t.options.reduce((a, o) => a + o.count, 0);
      if (n) {
        const w = t.options.reduce((a, o) => a + o.count * o.white, 0) / n;
        const d = t.options.reduce((a, o) => a + o.count * o.draw, 0) / n;
        points.push(point(`From here White scored ${Math.round(w + d / 2)}% in those games, with ${Math.round(d)}% drawn.`, "info", "rules"));
      }
    } else if (r.masters && last) {
      // No statistics for this position: the data ran out, the move didn't leave anything.
      points.push(point(`Theory runs out after ${numbered(last.move)}: too few games between strong players reached this position to go further.`, "info", "rules"));
    } else {
      points.push(point(`${who} left the book with ${numbered(left.move)}.`, "info", "rules"));
    }
  }
  return { name: r.opening?.name ?? null, eco: r.opening?.eco ?? null, points, leftPly: left ? left.move.ply : null };
}

/** For the move that left the book: what strong players play instead. */
function leftBookPoint(c: ClassifiedMove): InsightPoint | null {
  const t = c.theory;
  if (!t || c.cls === "book" || !t.options.length) return null;
  const choices = theoryChoices(c.move.fenBefore, t, c.move.uci);
  if (!choices.lines.length) return null;
  const rare = t.played ? ` ${numbered(c.move)} is rare here (${share(t.played.count, t.games)}).` : "";
  return { ...point(`This leaves opening theory.${rare} In ${games(t.games)}, ${SOURCES.toLowerCase()} played ${choices.text}.`, "info", "rules"), lines: choices.lines };
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
  const s = moveStory(c, prev);
  const left = leftBookPoint(c);
  return left ? { ...s, opening: [left] } : s;
}

function moveStory(c: ClassifiedMove, prev?: ClassifiedMove): MoveStory {
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
        headline: c.opening ? `${numbered(m)} is opening theory: ${c.opening.name} (${c.opening.eco}).` : `${numbered(m)} is opening theory.`,
        points: good.slice(0, 2),
        opening: bookPoints(c),
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
        const { text: line, line: peek } = peekLine(m.fenAfter, replyLine.pv);
        const mates = replyEnd?.san.includes("#");
        points.push(
          point(
            takes
              ? `${COLOR_NAME[them]} can take, but after ${line} ${mates ? "it's checkmate" : standing(c.evalAfter, me)}.`
              : `Taking is too dangerous: ${COLOR_NAME[them]}'s best reply is ${line} instead (${standing(c.evalAfter, me)}).`,
            "opportunity",
            "engine",
            { arrows: [arrow(reply, "danger")] },
            peek,
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
            { fen: m.fenBefore, pv: c.secondLine.pv, label: numbered(second) },
          ),
        );
      return { headline: `${numbered(m)}! The only good move here: every alternative is clearly worse.`, points };
    }

    case "best":
    case "excellent":
    case "good": {
      points.push(...good.slice(0, 2));
      if (!points.length) points.push(point("A quiet move: its point shows up in the engine's line below.", "info", "engine"));
      if (reply && replyLine) {
        const l = peekLine(m.fenAfter, replyLine.pv);
        points.push(point(`Engine line: ${l.text} (${formatEval(replyLine.eval)}).`, "info", "engine", { arrows: [arrow(reply, "info", true)] }, l.line));
      }
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
        const bl = bm ? { fen: m.fenBefore, pv: better.pv, label: numbered(bm) } : undefined;
        points.push(point(bp ? because(lead, bp.text) : `${lead}.`, "opportunity", "engine", better.marks, bl));
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
