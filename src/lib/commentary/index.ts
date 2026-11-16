/**
 * The commentary on one position: its types, what each side likes and dislikes, the plans
 * by type, and a few sentences that tie them together. `engine` is optional: without it the
 * commentary is the board's alone; with it the verdict, the critical-moment check and the
 * "the engine goes for this" notes are added.
 */
import { COLOR_NAME, other, type Color, type Square } from "../chess/types";
import { describeEval, evalFor, formatEval } from "../engine/score";
import { computeFacts, type PositionFacts } from "../facts";
import { netCaptures } from "../reason/ideas";
import { moveLabel } from "../reason/reason";
import { buildVariation } from "../variation";
import { features, materialWords, type Features } from "./features";
import { positionTypes, type EngineRead } from "./kinds";
import { sidePlans, withEngine } from "./plans";
import { sidePoints } from "./points";
import { findStructures } from "./structures";
import type { Commentary, Point, PositionType, StrategicPlan } from "./types";

export * from "./types";
export type { EngineRead } from "./kinds";
export { categoryOrder } from "./plans";

/** Lower-cases a sentence start so it can sit inside another sentence; names stay as they are. */
const lower = (s: string) => (/^(White|Black)\b/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/**
 * The position once the capturing the engine's line starts with is over, or null when its
 * first move isn't a capture: a piece that is about to be taken back isn't a piece up.
 */
function settledAfter(fen: string, pv: string[]): { fen: string; plies: number } | null {
  const v = buildVariation(fen, pv, 10);
  if (!v.moves[0]?.captured) return null;
  let last = 0;
  let quiet = 0;
  for (let i = 1; i < v.moves.length; i++) {
    if (v.moves[i].captured) {
      last = i;
      quiet = 0;
    } else if (++quiet >= 2) break;
  }
  return { fen: v.moves[last].fenAfter, plies: last + 1 };
}
const article = (s: string) => (/^[aeiou]/i.test(s) ? "an" : "a");

/** "A middlegame with a closed centre and the kings castled on opposite wings." */
function headline(f: Features, types: PositionType[]): string {
  const phase = types.find((t) => t.group === "phase")!;
  const structure = types.find((t) => t.group === "structure");
  const centre = types.find((t) => t.group === "centre");
  const kings = types.find((t) => t.group === "kings");
  const balance = types.find((t) => t.id === "ocb" || t.id === "imbalance");
  const subject = phase.phrase ?? `${article(phase.name)} ${lower(phase.name)}`;
  const parts: string[] = [];
  if (structure) parts.push(structure.phrase ?? lower(structure.name));
  else if (centre && f.phase !== "endgame") parts.push(centre.id === "centre-tension" ? "tension in the centre" : `${article(centre.name)} ${lower(centre.name)}`);
  if (kings) parts.push(kings.id === "kings-opposite" ? "the kings castled on opposite wings" : `${COLOR_NAME[kings.side!]}'s king ${kings.name.includes("stuck") ? "stuck" : "still"} in the centre`);
  if (balance && parts.length < 2) parts.push(balance.id === "ocb" ? "opposite-coloured bishops" : "unbalanced material");
  const tail = parts.length ? ` with ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}` : "";
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)}${tail}.`;
}

function story(f: Features, sides: Commentary["sides"], engine: EngineRead | undefined, decided: Color | null): string[] {
  const out: string[] = [];
  const mw = materialWords(f);
  const best = engine?.lines[0];
  const top = (c: Color, good: boolean): Point | undefined => (good ? sides[c].likes : sides[c].dislikes)[0];
  const phrase = (p: Point) => lower(p.title);
  const turn = f.turn;
  const first = best ? buildVariation(f.fen, best.pv, 1).moves[0] : undefined;

  if (best) {
    const v = describeEval(best.eval);
    const ev = formatEval(best.eval);
    if (v.strength === "mate") {
      out.push(`${v.headline}${first && v.leader === turn ? `, starting with ${moveLabel(first)}` : ""}. Nothing else in the position matters.`);
      return out;
    }
    if (!v.leader) {
      const w = top("w", true);
      const b = top("b", true);
      out.push(`The engine calls it level (${ev})${w && b ? `: ${phrase(w)} for White is balanced by ${phrase(b)} for Black` : mw && mw.points >= 1 ? `, even though ${COLOR_NAME[mw.side]} is ${mw.text}` : ""}.`);
    } else {
      const lead = v.leader;
      const trail = other(lead);
      // The reasons, in the leader's words: its best asset, and the other side's worst problem if it is a different thing.
      const asset = top(lead, true);
      const problem = top(trail, false);
      const reasons = [asset && phrase(asset), problem && problem.theme !== asset?.theme ? `${COLOR_NAME[trail]}'s ${phrase(problem).replace(/^(the|a|an) /, "")}` : null].filter((x): x is string => !!x);
      // The verdict itself is the heading above these lines: only say it again with its reasons.
      if (reasons.length) out.push(`${v.headline} (${ev}). What counts: ${reasons.join(", and ")}.`);
    }
  } else if (mw && mw.points >= 1) out.push(`${COLOR_NAME[mw.side]} is ${mw.text}.`);

  // What the side to move is after.
  const plans = sides[turn].plans;
  if (best && first) {
    const net = netCaptures(f.fen, best.pv, turn, 8, 2);
    const followed = plans.find((p) => p.engine?.follows === "main" && p.match?.(first));
    const before = staticPoints(f.fen, turn);
    if (net.swing >= 2 && before <= -2) out.push(`An exchange is under way: ${moveLabel(first)} takes back, and the pieces are counted here as they stand once it is over.`);
    else if (net.swing >= 2) out.push(`Tactics come first: ${moveLabel(first)} wins material, and no plan matters until that is settled.`);
    else if (followed) out.push(`${COLOR_NAME[turn]} to move. The engine's ${moveLabel(first)} belongs to the plan the position asks for: ${lower(followed.title)}.`);
    else if (decided === turn) out.push(`${COLOR_NAME[turn]} to move and winning. The engine plays ${moveLabel(first)}; from here it is about not giving anything back.`);
    else if (plans[0]) out.push(`${COLOR_NAME[turn]} to move. The engine's choice is ${moveLabel(first)}; beyond that, the position asks ${COLOR_NAME[turn]} to ${planVerb(plans[0])}.`);
  } else if (plans[0]) out.push(`${COLOR_NAME[turn]} to move. The position asks ${COLOR_NAME[turn]} to ${planVerb(plans[0])}.`);
  const reply = sides[other(turn)].plans[0];
  if (reply && out.length < 3 && decided !== turn) out.push(`${COLOR_NAME[other(turn)]} wants to ${planVerb(reply)}.`);
  return out;
}

/** Material on the board right now, in points, from `c`'s side. */
function staticPoints(fen: string, c: Color): number {
  const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let total = 0;
  for (const ch of fen.split(" ")[0]) {
    const v = value[ch.toLowerCase()];
    if (v) total += (ch === ch.toUpperCase()) === (c === "w") ? v : -v;
  }
  return total;
}

/** A plan's title as something to do: "Minority attack" → "start the minority attack". */
function planVerb(p: StrategicPlan): string {
  const t = lower(p.title);
  if (/^(attack|open|play|trade|bring|advance|finish|get|keep|block|lean|use|make|push|break|free)\b/.test(t)) return t;
  if (/^(minority attack|pawn storm)/.test(t)) return `start the ${t}`;
  if (/^(knight|a rook) to /.test(t)) return `bring ${t.replace(/^knight/, "a knight")}`;
  if (/^the freeing break/.test(t)) return `get in ${t}`;
  return `go for ${t}`;
}

/** An advantage of this size is the whole story: plans for the other side stop mattering. */
const DECIDED_CP = 450;

export function buildCommentary(fen: string, engine?: EngineRead, given?: PositionFacts): Commentary {
  const checked = !!engine?.lines.length;
  const facts = given ?? computeFacts(fen, checked ? { firstMoves: engine!.lines.map((l) => l.pv[0]) } : undefined);
  const best = engine?.lines[0];
  const settled = best ? settledAfter(fen, best.pv) : null;
  const f = features(fen, facts.ctx, settled?.fen);
  const mate = best?.eval.kind === "mate" ? best.eval.winner : null;
  const decided: Color | null = mate ?? (best && Math.abs(evalFor(best.eval, "w")) >= DECIDED_CP ? (evalFor(best.eval, "w") > 0 ? "w" : "b") : null);
  const structures = findStructures(f);
  const types = positionTypes(f, structures, facts, engine);
  const firstUci = best?.pv[0];
  const points = sidePoints(f, structures, facts, checked ? { first: firstUci ? { from: firstUci.slice(0, 2) as Square, to: firstUci.slice(2, 4) as Square } : undefined, decided: !!decided } : undefined);
  const plansOf = (c: Color): StrategicPlan[] => {
    if (mate) return [];
    const all = withEngine(f, sidePlans(f, structures, c), engine);
    // Once the game is decided, the losing side has only its defence left to talk about.
    return decided && decided !== c ? all.filter((p) => p.category === "defend").slice(0, 2) : all;
  };
  const sides: Commentary["sides"] = { w: { ...points.w, plans: plansOf("w") }, b: { ...points.b, plans: plansOf("b") } };
  return { phase: f.phase, types, headline: headline(f, types), story: story(f, sides, engine, decided), sides };
}
