/**
 * Move reasoning: why a move is good (or what goes wrong), from the board and from
 * targeted engine probes. Works for any position; nothing here knows about a game.
 *
 * Probes (each optional, all through the injected Searcher):
 *  - the line after the move (if not supplied);
 *  - the threat: let the mover move again (null move) and see what it wins;
 *  - the opponent's threat before the move, and whether the move stops it;
 * Board ideas come from ideas.ts and are weighted up when the engine line uses them.
 */
import { Chess } from "chess.js";
import { attacksFrom } from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, other, type Color, type Square } from "../chess/types";
import type { Searcher } from "../deep/deep";
import { evalFor, formatEval, type Evaluation } from "../engine/score";
import { emptyMarks, type Marks } from "../facts/types";
import { buildVariation, type VariationMove } from "../variation";
import { boardIdeas, consequences, gainWords, netCaptures, nm, type IdeaContext } from "./ideas";
import { narrate } from "./line";
import type { Alternative, Idea, MoveReasoning } from "./types";

export interface LineInput {
  pv: string[];
  eval: Evaluation;
  depth: number;
}

export interface ReasonInput {
  /** Position before the move. */
  fen: string;
  uci: string;
  /** The engine's line starting with this move (searched if missing and a searcher is given). */
  line?: LineInput;
  /** The engine's best and second-best lines from `fen` (for comparisons). */
  best?: LineInput;
  second?: LineInput;
  search?: Searcher;
  depth?: number;
  /** Which engine probes to run (default: all). */
  probes?: { threat?: boolean; opponentThreat?: boolean };
  /** The opponent's threat in `fen`, if already worked out (null: there is none). */
  threatBefore?: ThreatInfo | null;
}

/** A threat the side not to move would carry out if it were its turn. */
export interface ThreatInfo {
  uci: string;
  san: string;
  label: string;
  /** "winning the bishop on g4", "with mate in 2", … */
  why: string;
  /** How much it would gain, mover-relative centipawns (large for mate). */
  size: number;
  mates: boolean;
  marks: Marks;
}

const clamp = (n: number) => Math.max(-3000, Math.min(3000, n));
const mv = (e: Evaluation, c: Color) => clamp(evalFor(e, c));
export const moveLabel = (m: { moveNumber: number; color: Color; san: string }) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;
const short = (m: { color: Color; san: string }) => `${m.color === "w" ? "" : "…"}${m.san}`;

/** The position with the other side to move (null move), or null if that's illegal. */
export function nullMove(fen: string): string | null {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  const f = parts.join(" ");
  try {
    const c = new Chess(f);
    // The side that just "passed" must not be giving check.
    const back = new Chess(fen);
    if (back.inCheck()) return null;
    void c;
    return f;
  } catch {
    return null;
  }
}

const DOUBLE = new Set(["pin", "trap", "win", "hit", "grab", "stop", "drop", "cut"]);

/** "forks the king" → "forking the king", "pins x" → "pinning x", "takes x" → "taking x". */
export function gerund(phrase: string): string {
  return phrase.replace(/^([a-z]+?)(e?s)\b/, (_, stem: string, ending: string) => {
    let base = stem + (ending === "es" && /(ss|sh|ch|x|z)$/.test(stem) ? "" : ending === "es" ? "e" : "");
    if (base.endsWith("e") && !base.endsWith("ee")) base = base.slice(0, -1);
    if (DOUBLE.has(base)) base += base[base.length - 1];
    return `${base}ing`;
  });
}

const CONCRETE = new Set(["mate", "material", "fork", "pin", "skewer", "attack", "king-attack", "promotion", "restrict", "defender"]);

/** What a move would achieve, in one phrase: "winning the bishop", "with mate in 2", or its sharpest board idea. */
function purpose(fen: string, pv: string[], e: Evaluation, mover: Color): string {
  if (e.kind === "mate" && e.winner === mover) return `with mate in ${e.moves}`;
  // Only the threat itself and the replies to it, not whatever happens later in the line.
  const net = netCaptures(fen, pv, mover, 4, 2);
  if (net.swing >= 1) return `winning ${gainWords(net)}`;
  const v = buildVariation(fen, pv, 8);
  const first = v.moves[0];
  if (!first) return "";
  const ctx: IdeaContext = { after: v.moves.slice(1), evalAfter: mv(e, mover) };
  const top = boardIdeas(first, ctx).find((i) => CONCRETE.has(i.kind));
  if (top) return gerund(top.phrase);
  return first.isCheck ? "with a dangerous check" : "";
}

/** The opponent's best move if the side to move passed: their threat, if it's concrete. */
export async function findThreat(fen: string, search: Searcher, depth: number, reference: Evaluation): Promise<ThreatInfo | null> {
  const nf = nullMove(fen);
  if (!nf) return null;
  const them = nf.split(" ")[1] as Color;
  const me = other(them);
  const r = (await search({ fen: nf, depth, multipv: 1 }))[0];
  const rm = r?.pv.length ? buildVariation(nf, r.pv, 1).moves[0] : undefined;
  if (!r || !rm) return null;
  const size = mv(reference, me) - mv(r.eval, me);
  const mates = r.eval.kind === "mate" && r.eval.winner === them;
  const net = netCaptures(nf, r.pv, them, 8);
  // A real threat wins material, mates, or is a check the engine rates very highly.
  if (!(mates || (size >= 150 && net.swing >= 1) || (size >= 300 && rm.isCheck))) return null;
  return {
    uci: rm.uci,
    san: rm.san,
    label: short(rm),
    why: purpose(nf, r.pv, r.eval, them),
    size,
    mates,
    marks: { ...emptyMarks(), arrows: [{ from: rm.from, to: rm.to, tone: "danger" }] },
  };
}

function headlineOf(label: string, ideas: Idea[]): string {
  const good = ideas.filter((i) => i.tone !== "danger");
  if (!good.length) return `${label} is a quiet move: its point shows up in the engine line.`;
  const [a, ...rest] = good;
  const b = rest.find((x) => x.kind !== a.kind && x.weight >= a.weight * 0.5 && !a.phrase.includes(x.phrase));
  return `${label} ${a.phrase}${b ? `${a.phrase.includes(",") ? "," : ""} and ${b.phrase}` : ""}.`;
}

export async function reasonMove(inp: ReasonInput): Promise<MoveReasoning | null> {
  const first = buildVariation(inp.fen, [inp.uci], 1).moves[0];
  if (!first) return null;
  const me = first.color;
  const them = other(me);
  const depth = inp.depth ?? 14;
  const search = inp.search;
  const probes = { threat: true, opponentThreat: true, ...inp.probes };

  let line = inp.line && inp.line.pv[0] === inp.uci ? inp.line : undefined;
  if (!line && search) {
    const after = (await search({ fen: first.fenAfter, depth, multipv: 1 }))[0];
    line = after ? { pv: [inp.uci, ...after.pv], eval: after.eval, depth: after.depth } : undefined;
  }
  const evalAfter = line?.eval ?? inp.best?.eval ?? { kind: "cp", cp: 0 };
  const afterMoves: VariationMove[] = line ? buildVariation(first.fenAfter, line.pv.slice(1), 10).moves : [];
  const nearBest = !inp.best || inp.best.pv[0] === inp.uci || mv(evalAfter, me) >= mv(inp.best.eval, me) - 60;
  const ideas = boardIdeas(first, { after: afterMoves, evalAfter: mv(evalAfter, me), goodMove: nearBest });

  // What does the move threaten? Only new, concrete threats (not "I could take back" after a capture).
  const reply = afterMoves[0];
  const recapture = !!(first.captured && reply?.captured && reply.to === first.to);
  if (search && probes.threat && !first.isCheck && !first.san.includes("#") && !recapture) {
    const t = await findThreat(first.fenAfter, search, Math.max(10, depth - 2), evalAfter);
    if (t) {
      const bp = placementFromFen(inp.fen);
      const from = t.uci.slice(0, 2) as Square;
      const to = t.uci.slice(2, 4) as Square;
      const existed = from !== first.to && bp[from]?.color === me && !!bp[to] && bp[to]!.color === them && attacksFrom(bp, from).includes(to);
      if (!existed) {
        ideas.push({
          kind: "threat",
          phrase: `threatens ${t.label}${t.why ? `, ${t.why}` : ""}`,
          text: `It threatens ${t.label}${t.why ? `, ${t.why}` : ""}, so ${COLOR_NAME[them]} has to spend the next move on it.`,
          tone: "opportunity",
          evidence: "engine",
          weight: t.mates ? 70 : 28 + Math.min(30, t.size / 25),
          marks: { ...emptyMarks(), arrows: t.marks.arrows.map((a) => ({ ...a, tone: "opportunity" as const, dashed: true })) },
        });
      }
    }
  }

  // What was the opponent threatening, and does this move deal with it?
  let opponentThreat: MoveReasoning["opponentThreat"];
  if (search && probes.opponentThreat) {
    const th = inp.threatBefore !== undefined ? inp.threatBefore : await findThreat(inp.fen, search, Math.max(10, depth - 2), inp.best?.eval ?? evalAfter);
    if (th) {
      let parried = true;
      const legalNow = new Chess(first.fenAfter).moves({ verbose: true }).some((x) => x.lan === th.uci);
      if (legalNow && reply?.uci !== th.uci) {
        const test = (await search({ fen: first.fenAfter, depth: Math.max(10, depth - 2), multipv: 1, searchmoves: [th.uci] }))[0];
        if (test) parried = mv(test.eval, me) >= mv(evalAfter, me) - 60;
      } else if (reply?.uci === th.uci) parried = false;
      const text = `${COLOR_NAME[them]} was threatening ${th.label}${th.why ? `, ${th.why}` : ""}.`;
      opponentThreat = { san: th.san, text, parried, marks: th.marks };
      if (parried && !first.isCheck) {
        // The threatened piece is the one moving (not a pawn making luft against a mate).
        const saves = th.uci.slice(2, 4) === first.from && first.piece !== "p" && !th.mates;
        if (saves) {
          // The threatened piece is the one moving: say it steps away, and drop the plainer "saves" idea.
          const i = ideas.findIndex((x) => x.kind === "defence" && x.phrase.startsWith("saves"));
          if (i >= 0) ideas.splice(i, 1);
        }
        const pieceName = saves ? nm(placementFromFen(inp.fen), first.from).replace(/^the /, "") : "";
        ideas.push({
          kind: "parry",
          phrase: saves
            ? first.captured
              ? `trades off the attacked ${pieceName.split(" on ")[0]} instead of losing it to ${th.label}`
              : `gets the ${pieceName.split(" on ")[0]} out of the way of ${th.label}`
            : th.mates
              ? `stops the mate threat ${th.label}`
              : `stops ${th.label}`,
          text: saves ? `${text} ${first.captured ? `The ${pieceName.split(" on ")[0]} takes something with it instead.` : `The ${pieceName.split(" on ")[0]} steps away.`}` : `${text} ${first.san} takes care of it.`,
          tone: "info",
          evidence: "engine",
          weight: th.mates ? 50 : 24 + Math.min(24, th.size / 30),
          marks: th.marks,
        });
      }
    }
  }

  // Why not the next-best move? (For strong moves, when the gap is real.)
  const alternatives: Alternative[] = [];
  const isBest = inp.best?.pv[0] === inp.uci;
  const second = isBest ? inp.second : inp.best;
  if (second && second.pv[0] !== inp.uci && line) {
    const gap = mv(evalAfter, me) - mv(second.eval, me);
    const sv = buildVariation(inp.fen, second.pv, 6).moves;
    if (sv[0] && (isBest ? gap >= 50 : true)) {
      const rep = sv[1];
      const repIdea = rep ? purpose(sv[0].fenAfter, second.pv.slice(1), second.eval, them) : "";
      const text = isBest
        ? `${moveLabel(sv[0])} is weaker (${formatEval(second.eval)} against ${formatEval(evalAfter)})${rep ? `: ${COLOR_NAME[them]} answers ${moveLabel(rep)}${repIdea ? `, ${repIdea}` : ""}` : ""}.`
        : gap > -40
          ? `${moveLabel(sv[0])} is about as good (${formatEval(second.eval)}): the engine sees almost no difference.`
          : `The engine prefers ${moveLabel(sv[0])} (${formatEval(second.eval)}).`;

      alternatives.push({ san: sv[0].san, text, pv: second.pv, marks: { ...emptyMarks(), arrows: [{ from: sv[0].from, to: sv[0].to, tone: "danger", dashed: true }] } });
    }
  }

  // The opponent's answer in the engine line, and what it does (the refutation, for a bad move).
  let refutation: MoveReasoning["refutation"];
  if (reply) {
    const net = netCaptures(inp.fen, line!.pv, them, 12, 4);
    const wins = net.swing >= 1 ? `winning ${gainWords(net)}` : "";
    // The reply's own "material" idea would count a recapture as a win; the line total above is what counts.
    const rideas = boardIdeas(reply, { after: afterMoves.slice(1), evalAfter: -mv(evalAfter, me) }).filter((i) => i.kind !== "material" && i.kind !== "trade");
    const top = rideas.find((i) => CONCRETE.has(i.kind) || i.kind === "threat" || i.kind === "check");
    const recapture2 = !!(first.captured && reply.captured && reply.to === first.to);
    const takes = reply.captured && !recapture2 ? `taking ${nm(placementFromFen(reply.fenBefore), reply.to)}` : "";
    const extra = top && !takes.includes(top.phrase) ? gerund(top.phrase) : "";
    const damage = wins ? [] : consequences(inp.fen, line!.pv, me);
    const leaves = damage.length ? `, leaving ${COLOR_NAME[me]} with ${damage.slice(0, 2).join(" and ")}` : "";
    const what = wins || [recapture2 ? "taking back" : takes, extra].filter(Boolean).join(" and ");
    refutation = {
      san: reply.san,
      text: `${COLOR_NAME[them]} answers ${moveLabel(reply)}${what ? `, ${what}` : ""}${leaves}.`,
      marks: { ...emptyMarks(), arrows: [{ from: reply.from, to: reply.to, tone: "danger" }], squares: top?.marks.squares ?? [] },
    };
  }

  ideas.sort((a, b) => b.weight - a.weight);
  const label = moveLabel(first);
  return {
    uci: inp.uci,
    san: first.san,
    label,
    headline: headlineOf(label, ideas),
    ideas,
    line: line ? narrate(first.fenAfter, line.pv.slice(1), evalAfter, me, 12, inp.fen) : undefined,
    alternatives,
    opponentThreat,
    refutation,
  };
}
