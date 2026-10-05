/**
 * Deep move understanding: explains a move from the engine's lines, not from one
 * static snapshot. Given the move's own engine line and the other candidate lines,
 * it runs a few extra searches to answer the questions a coach would:
 *
 *  - How good is it compared with the alternatives? (the same labels as game review)
 *  - Does it offer material, and what happens if the opponent takes? (sacrifice lines)
 *  - What does it threaten if the opponent ignores it? (null-move search)
 *  - Where does the line go, and what are the key moments? (walk the PV)
 *
 * Everything here is either computed from the rules or read off an engine search; the
 * searches are injected so the module runs the same in the browser and in tests.
 */
import { Chess } from "chess.js";
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, PIECE_VALUE, other, type Color, type PieceSymbol, type Square } from "../chess/types";
import type { EngineLine } from "../engine/client";
import { evalFor, formatEval, type Evaluation } from "../engine/score";
import { enPrise, makeCtx } from "../facts/context";
import { materialSwing, staticMovePoints, type InsightPoint } from "../facts/explain";
import { materialSummary } from "../facts/material";
import { emptyMarks, type Marks, type Tone } from "../facts/types";
import { reasonMove } from "../reason/reason";
import { ANNOTATION, CLASS_INFO, classifyCandidate, type MoveClass } from "../review/classify";
import { buildVariation, type VariationMove } from "../variation";

export interface SearchRequest {
  fen: string;
  depth: number;
  multipv?: number;
  searchmoves?: string[];
  fresh?: boolean;
}

/** Anything that can run a search: the browser worker, or the Node engine in tests. */
export type Searcher = (req: SearchRequest) => Promise<EngineLine[]>;

export interface LineInput {
  pv: string[];
  eval: Evaluation;
  depth: number;
}

export interface Classification {
  kind: MoveClass;
  symbol: string;
  label: string;
}

/** `symbol` is the annotation mark ("!!", "?" …), empty for plain good moves. */
export const classification = (kind: MoveClass): Classification => ({ kind, symbol: ANNOTATION[kind] ?? "", label: CLASS_INFO[kind].label });

export interface Offer {
  /** The capture the opponent could make. */
  uci: string;
  san: string;
  captured: PieceSymbol;
  capturedOn: Square;
  /** True if the piece was already loose before the move (so it's not a sacrifice, just tactically protected). */
  existing: boolean;
  /** Ply (from the analysed position) best showing the refutation: 1 = our move, 2 = the capture… */
  showPly: number;
  /** What to draw on the board at `showPly`. */
  showMarks: Marks;
  /** Engine line starting with the capture (from the position after our move). */
  pv: string[];
  sans: string[];
  eval: Evaluation;
  /** How much worse the capture is for the opponent than their best reply, in centipawns. */
  costToOpponent: number;
  poisoned: boolean;
  text: string;
  marks: Marks;
}

export interface Threat {
  uci: string;
  san: string;
  gain: number;
  text: string;
  marks: Marks;
}

export interface Moment {
  /** Ply counted from the analysed position (1 = the move itself). */
  ply: number;
  label: string;
  color: Color;
  text: string;
  tone: Tone;
  marks: Marks;
}

export interface DeepMove {
  uci: string;
  san: string;
  label: string;
  mover: Color;
  eval: Evaluation;
  depth: number;
  classification: Classification;
  headline: string;
  points: InsightPoint[];
  offers: Offer[];
  threat?: Threat;
  reply?: { san: string; label: string; text: string };
  moments: Moment[];
  /** The main line the explanation follows (deeper than the root search when available). */
  pv: string[];
  outcome: string;
  comparison?: { san: string; eval: Evaluation; gap: number; text: string };
}

const moveLabel = (m: VariationMove) => (m.color === "w" ? `${m.moveNumber}.${m.san}` : `${m.moveNumber}…${m.san}`);

const clampCp = (n: number) => Math.max(-3000, Math.min(3000, n));
const pawns = (cp: number) => (cp / 100).toFixed(1);

/** Mover-relative gap between two evaluations, clamped so mates don't explode. */
function gap(better: Evaluation, worse: Evaluation, mover: Color) {
  return clampCp(evalFor(better, mover)) - clampCp(evalFor(worse, mover));
}

/** "Loud" moments in a line: captures, checks, promotions, or moves that create a new target. */
function notable(v: VariationMove[], from: number, count: number, rootPly: number, only?: Color): Moment[] {
  const out: Moment[] = [];
  for (let i = from; i < v.length && out.length < count; i++) {
    const m = v[i];
    if (only && m.color !== only) continue;
    const pts = staticMovePoints(m);
    const strong = pts.find((p) => p.tone === "opportunity" && !/quiet/i.test(p.text)) ?? (m.captured || m.isCheck ? pts[0] : undefined);
    if (!strong) continue;
    const marks = { ...emptyMarks(), ...strong.marks, arrows: [{ from: m.from, to: m.to, tone: m.color === v[0].color ? ("opportunity" as const) : ("danger" as const) }, ...strong.marks.arrows] };
    out.push({ ply: rootPly + i + 1, label: moveLabel(m), color: m.color, text: strong.text, tone: m.color === v[0].color ? "opportunity" : "danger", marks });
  }
  return out;
}

function materialWords(diff: number): string {
  const n = Math.abs(diff);
  if (n === 0) return "level material";
  if (n === 1) return "a pawn";
  if (n === 2) return "two pawns";
  if (n === 3) return "a piece";
  if (n === 5) return "a rook";
  if (n === 9) return "a queen";
  return `${n} points of material`;
}

export interface DeepOptions {
  depth?: number;
  /** True if `line` is the engine's first choice. */
  isBest: boolean;
  /** The best line (needed when explaining a non-best move). */
  bestLine?: LineInput;
  /** Other candidate lines from the same position, best first. */
  alternatives?: LineInput[];
  onProgress?: (step: string) => void;
}

export async function analyzeMoveDeep(fen: string, line: LineInput, search: Searcher, opts: DeepOptions): Promise<DeepMove | null> {
  const depth = opts.depth ?? 16;
  const v = buildVariation(fen, line.pv, 24);
  const m = v.moves[0];
  if (!m) return null;
  const mover = m.color;
  const opp = other(mover);
  const afterFen = m.fenAfter;
  const points = staticMovePoints(m);

  // 1. What if the opponent takes material? Search each tempting capture on its own.
  opts.onProgress?.("Testing what happens if the offer is taken");
  // An "offer" is material that becomes takeable because of this move: the moved piece
  // itself, or something it stopped protecting. Pieces that were already loose aren't offers.
  const afterCtx = makeCtx(afterFen);
  const wasLoose = new Set<Square>();
  {
    const parts = fen.split(" ");
    parts[1] = opp;
    parts[3] = "-";
    try {
      const beforeCtx = makeCtx(parts.join(" "));
      for (const sq of Object.keys(beforeCtx.p) as Square[]) if (beforeCtx.p[sq]?.color === mover && enPrise(beforeCtx, sq)) wasLoose.add(sq);
    } catch {
      /* the null position can be illegal; then only the moved piece counts */
    }
  }
  const legal = new Chess(afterFen).moves({ verbose: true });
  const tempting = legal
    .filter((x) => x.captured && x.captured !== "k")
    .filter((x) => enPrise(afterCtx, x.to) || PIECE_VALUE[x.captured!] > PIECE_VALUE[x.piece])
    .sort((a, b) => PIECE_VALUE[b.captured!] - PIECE_VALUE[a.captured!])
    .filter((x, i, arr) => arr.findIndex((y) => y.to === x.to) === i);
  const fresh = tempting.filter((x) => x.to === m.to || !wasLoose.has(x.to)).slice(0, 2);
  // Pieces that were already loose and still are: is the engine happy to leave them? Test one.
  const existing = tempting.filter((x) => x.to !== m.to && wasLoose.has(x.to)).slice(0, 1);
  const captures = [...fresh, ...existing];
  const offers: Offer[] = [];
  // One multi-line search of the position after the move gives the opponent's best replies
  // at a single depth, so "take" and "decline" are compared like for like. It's also a
  // deeper look at the main line than the root search, so it wins when the two disagree.
  const replies = await search({ fen: afterFen, depth, multipv: captures.length ? 4 : 1 });
  const deepPv = replies[0]?.pv.length ? [m.uci, ...replies[0].pv] : line.pv;
  const deepEval = replies[0]?.pv.length ? replies[0].eval : line.eval;
  const dv = buildVariation(fen, deepPv, 24);
  const capSquares = new Set(captures.map((c) => c.lan));
  const decline = replies.find((l) => !capSquares.has(l.pv[0]));
  for (const c of captures) {
    let capLine: EngineLine | undefined = replies.find((l) => l.pv[0] === c.lan);
    if (!capLine) capLine = (await search({ fen: afterFen, depth, searchmoves: [c.lan] }))[0];
    if (!capLine || !capLine.pv.length) continue;
    const cv = buildVariation(afterFen, capLine.pv, 16);
    const reference = decline ?? { eval: line.eval, pv: line.pv.slice(1) };
    const cost = gap(capLine.eval, reference.eval, mover); // positive: taking is worse for the opponent
    const bestReplyIsCapture = replies[0]?.pv[0] === c.lan;
    const poisoned = cost >= 35 && !bestReplyIsCapture;
    const refute = cv.moves[1];
    // The mover's first forceful follow-up after the capture (skipping the immediate answer).
    const follow = notable(cv.moves, 2, 1, 1, mover)[0];
    const swing = materialSwing(afterFen, capLine.pv, mover, 12);
    const isExisting = existing.includes(c);
    const sentences: string[] = [];
    if (isExisting) sentences.push(`The ${PIECE_NAME[c.captured!]} on ${c.to} looks loose, and ${m.san} leaves it there on purpose.`);
    sentences.push(`If ${COLOR_NAME[opp]} grabs it with ${moveLabel(cv.moves[0])}, ${COLOR_NAME[mover]} answers ${refute ? moveLabel(refute) : "strongly"}.`);
    if (follow) sentences.push(`Then ${follow.label}: ${follow.text.charAt(0).toLowerCase()}${follow.text.slice(1)}`);
    else if (cv.moves.length > 2) sentences.push(`The line goes on ${cv.moves.slice(2, 6).map(moveLabel).join(" ")}.`);
    if (swing.swing > 0) sentences.push(`${COLOR_NAME[mover]} ends up ${materialWords(swing.swing)} ahead.`);
    sentences.push(
      poisoned
        ? `The engine rates that ${formatEval(capLine.eval)}, better for ${COLOR_NAME[mover]} than if ${COLOR_NAME[opp]} declines (${formatEval(reference.eval)}): the ${PIECE_NAME[c.captured!]} is ${isExisting ? "tactically protected" : "poisoned"}.`
        : `The engine rates that ${formatEval(capLine.eval)}, about the same as declining (${formatEval(reference.eval)}): taking is playable.`,
    );
    const text = sentences.join(" ");
    const marks = emptyMarks();
    marks.arrows.push({ from: c.from, to: c.to, tone: "danger" });
    if (refute) marks.arrows.push({ from: refute.from, to: refute.to, tone: "opportunity" });
    if (follow) marks.arrows.push(...follow.marks.arrows.slice(0, 1));
    marks.squares.push({ sq: c.to, tone: "danger", style: "pulse" });
    offers.push({
      existing: isExisting,
      uci: c.lan,
      san: c.san,
      captured: c.captured!,
      capturedOn: c.to,
      showPly: follow ? follow.ply : Math.min(3, cv.moves.length + 1),
      showMarks: follow ? follow.marks : refute ? { ...emptyMarks(), arrows: [{ from: refute.from, to: refute.to, tone: "opportunity" }] } : emptyMarks(),
      pv: capLine.pv,
      sans: cv.moves.map(moveLabel),
      eval: capLine.eval,
      costToOpponent: cost,
      poisoned,
      text,
      marks,
    });
  }

  // 2. What does the move threaten? Let the mover play twice (null move) and keep only concrete threats.
  let threat: Threat | undefined;
  if (!m.isCheck) {
    opts.onProgress?.("Looking for the threat");
    const parts = afterFen.split(" ");
    parts[1] = mover;
    parts[3] = "-";
    const nullFen = parts.join(" ");
    let ok = true;
    try {
      new Chess(nullFen);
    } catch {
      ok = false;
    }
    if (ok) {
      const t = (await search({ fen: nullFen, depth: Math.max(10, depth - 2) }))[0];
      if (t?.pv.length) {
        const tv = buildVariation(nullFen, t.pv, 10);
        const first = tv.moves[0];
        const g = gap(t.eval, line.eval, mover);
        const swing = materialSwing(nullFen, t.pv, mover, 8);
        const mates = t.eval.kind === "mate" && t.eval.winner === mover;
        if (first && (mates || (g >= 80 && (swing.swing >= 1 || first.captured || first.isCheck)))) {
          const pts = staticMovePoints(first);
          const why = mates ? "mate" : swing.swing > 0 ? `winning ${materialWords(swing.swing)}` : (pts[0]?.text.replace(/\.$/, "").toLowerCase() ?? "a strong follow-up");
          threat = {
            uci: first.uci,
            san: first.san,
            gain: g,
            text: `It threatens ${first.san}${why ? `, ${why}` : ""}. ${COLOR_NAME[opp]} has to spend the reply dealing with it.`,
            marks: { ...emptyMarks(), arrows: [{ from: first.from, to: first.to, tone: "opportunity" }], squares: pts[0]?.marks.squares ?? [] },
          };
        }
      }
    }
  }

  // 3. The line itself: key moments and where it ends up.
  const moments = notable(dv.moves, 1, 4, 0);
  const startDiff = materialSummary(placementFromFen(fen)).diff;
  // Measure material at a settled point: the last ply (up to 14) not in the middle of an exchange.
  let settle = Math.min(dv.moves.length, 14);
  while (settle > 1 && (dv.moves[settle - 1]?.captured || dv.moves[settle]?.captured)) settle--;
  const endFen = dv.moves[settle - 1]?.fenAfter ?? afterFen;
  const endDiff = materialSummary(placementFromFen(endFen)).diff - startDiff;
  const endForMover = mover === "w" ? endDiff : -endDiff;
  const outcome =
    `${settle > 1 ? `By ${moveLabel(dv.moves[settle - 1])} in the main line` : "After the move"}, ` +
    (endForMover > 0 ? `${COLOR_NAME[mover]} is ${materialWords(endForMover)} up in material` : endForMover < 0 ? `${COLOR_NAME[mover]} has given up ${materialWords(endForMover)}` : "material is unchanged") +
    ` and the engine rates the position ${formatEval(deepEval)}.`;

  // 4. Compared with the alternatives.
  let comparison: DeepMove["comparison"];
  const alts = (opts.alternatives ?? []).filter((a) => a.pv[0] !== m.uci);
  if (opts.isBest && alts[0]) {
    const alt = alts[0];
    const altSan = buildVariation(fen, alt.pv.slice(0, 1)).moves[0]?.san ?? alt.pv[0];
    const d = gap(line.eval, alt.eval, mover);
    const bestMates = line.eval.kind === "mate" && line.eval.winner === mover;
    const altMates = alt.eval.kind === "mate" && alt.eval.winner === mover;
    comparison = {
      san: altSan,
      eval: alt.eval,
      gap: d,
      text:
        bestMates && !altMates
          ? `Anything else lets the mate slip: the next best, ${altSan}, is only ${formatEval(alt.eval)}.`
          : d >= 150
            ? `Nothing else comes close: the next best, ${altSan}, gives away ${pawns(d)} pawns of advantage (${formatEval(alt.eval)}).`
            : d >= 60
              ? `Clearly the strongest: the next best, ${altSan}, is ${pawns(d)} pawns worse (${formatEval(alt.eval)}).`
              : d >= 25
                ? `A little better than ${altSan} (${formatEval(alt.eval)}), by ${pawns(d)} pawns.`
                : `${altSan} is about as good (${formatEval(alt.eval)}); there's more than one way here.`,
    };
  }

  // Same labelling rules as game review: expected-score bands, and Brilliant only for a real (exchange-checked) sacrifice.
  const bestRef = opts.isBest ? line : (opts.bestLine ?? line);
  const secondRef = opts.isBest ? (alts[0] ?? null) : null;
  const cls = classifyCandidate(fen, line, bestRef, secondRef)?.cls ?? (opts.isBest ? "best" : "good");
  const cl = classification(cls);

  const poisoned = offers.find((o) => o.poisoned && !o.existing);
  const moverName = COLOR_NAME[mover];
  // The move's ideas, from the same reasoning engine as game review (threats are probed above already).
  opts.onProgress?.("Working out what the move does");
  const reasoning = await reasonMove({
    fen,
    uci: m.uci,
    line: { pv: deepPv, eval: deepEval, depth },
    best: opts.isBest ? line : opts.bestLine,
    second: opts.isBest ? alts[0] : undefined,
    search,
    depth: Math.max(12, depth - 2),
    probes: { threat: false, opponentThreat: true },
  }).catch(() => null);
  if (reasoning) {
    const fromIdeas: InsightPoint[] = reasoning.ideas
      .filter((i) => i.kind !== "threat" && (i.tone !== "danger" || i.weight >= 6))
      .slice(0, 5)
      .map((i) => ({ text: i.text, tone: i.tone, evidence: i.evidence, marks: i.marks, ...(i.line ? { line: i.line } : {}) }));
    points.splice(0, points.length, ...fromIdeas);
  }
  let headline: string;
  if (m.san.includes("#")) headline = `${m.san} is checkmate.`;
  else if (line.eval.kind === "mate" && line.eval.winner === mover) headline = `${m.san} forces mate in ${line.eval.moves}.`;
  else if (poisoned)
    headline = `${m.san} offers the ${PIECE_NAME[poisoned.captured]} on ${poisoned.capturedOn}, but taking it walks into ${poisoned.sans[1] ?? "a strong reply"}. ${cl.kind === "brilliant" ? "A real sacrifice." : ""}`.trim();
  else if (reasoning && !/quiet move/.test(reasoning.headline))
    headline = threat && !reasoning.headline.includes("threatens") ? reasoning.headline.replace(/\.$/, `, and threatens ${threat.san}.`) : reasoning.headline;
  else if (threat) headline = `${m.san} sets up a threat: ${threat.san}.`;
  else if (cl.kind === "great" && comparison && comparison.gap >= 150) headline = `${m.san} is the only move that keeps ${moverName}'s chances.`;
  else headline = points.find((p) => p.tone === "opportunity")?.text ?? `${m.san} improves ${moverName}'s position; the point shows up later in the line.`;

  const r = dv.moves[1];
  const replyInfo = r
    ? { san: r.san, label: moveLabel(r), text: staticMovePoints(r)[0]?.text ?? "A quiet defensive move." }
    : undefined;

  // A capture that the engine shows is poisoned isn't a real concession: drop the static "can be taken" warning.
  const cleanedPoints = poisoned ? points.filter((p) => !(p.tone === "danger" && /can be taken|en prise/.test(p.text))) : points;

  return {
    uci: m.uci,
    san: m.san,
    label: moveLabel(m),
    mover,
    eval: line.eval,
    depth: line.depth,
    classification: cl,
    headline,
    points: cleanedPoints,
    offers,
    threat,
    reply: replyInfo,
    moments,
    pv: deepPv,
    outcome,
    comparison,
  };
}
