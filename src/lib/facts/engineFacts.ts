/**
 * Facts that need the engine. The "threat" is found by letting the opponent move
 * twice (a null move): if that gains a lot, the opponent has a real threat.
 */
import { COLOR_NAME, other, type Color } from "../chess/types";
import { evalFor, formatEval, type Evaluation } from "../engine/score";
import { buildVariation } from "../variation";
import { staticMovePoints } from "./explain";
import { emptyMarks, type Fact } from "./types";

export const THREAT_THRESHOLD_CP = 150;

export function nullMoveFenOf(fen: string): string {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  return parts.join(" ");
}

export function threatFact(fen: string, rootEval: Evaluation, threat: { pv: string[]; eval: Evaluation; depth: number }): Fact | null {
  const stm = fen.split(" ")[1] as Color;
  const opp = other(stm);
  const clamp = (n: number) => Math.max(-3000, Math.min(3000, n));
  const gain = clamp(evalFor(threat.eval, opp)) - clamp(evalFor(rootEval, opp));
  const mates = threat.eval.kind === "mate" && threat.eval.winner === opp;
  if (gain < THREAT_THRESHOLD_CP && !mates) return null;
  const v = buildVariation(nullMoveFenOf(fen), threat.pv.slice(0, 1));
  const m = v.moves[0];
  if (!m) return null;
  const pts = staticMovePoints(m);
  const what = pts.find((p) => p.tone === "opportunity")?.text.replace(/\.$/, "").toLowerCase();
  const marks = emptyMarks();
  marks.arrows.push({ from: m.from, to: m.to, tone: "danger" });
  for (const p of pts) marks.squares.push(...p.marks.squares.map((s) => ({ ...s, tone: "danger" as const })));
  return {
    id: `threat-${m.uci}`,
    lens: "threats",
    kind: "engine-threat",
    side: stm,
    tone: "danger",
    anchor: m.to,
    title: mates
      ? `${COLOR_NAME[opp]} threatens mate, starting with ${m.san}.`
      : `${COLOR_NAME[opp]} threatens ${m.san}${what ? `: ${what}` : ""}.`,
    detail: `If ${COLOR_NAME[stm]} ignored it, the engine rates ${m.san} at ${formatEval(threat.eval)} instead of ${formatEval(rootEval)} (depth ${threat.depth}). ${COLOR_NAME[stm]}'s move should deal with this.`,
    evidence: "engine",
    marks,
    priority: 95,
  };
}
