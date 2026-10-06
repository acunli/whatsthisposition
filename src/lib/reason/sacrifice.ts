/**
 * Why a sacrifice works, in plain words. For a move that gives material away, it
 * answers the questions a player actually has:
 *
 *  1. What is given up, and was there a threat the move ignores?
 *  2. What does the move do instead (what it takes, which defender it removes)?
 *  3. What if they take? Each realistic way of taking is played out by the engine,
 *     and we say what happens next: which piece gets away, what is threatened, and
 *     how it ends (mate, material, or a winning position).
 *  4. Their best defence, if it isn't taking.
 *  5. Why not the obvious move (saving the attacked piece, or the quiet alternative)?
 *
 * Everything comes from the board and engine searches; nothing knows about a game.
 */
import { Chess } from "chess.js";
import { attackersOf, attacksFrom, isLightSquare, kingSquare, piecesOf } from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, PIECE_VALUE, other, type Color, type Placement, type Square } from "../chess/types";
import type { Searcher } from "../deep/deep";
import { evalFor, formatEval, type Evaluation } from "../engine/score";
import { materialSummary } from "../facts/material";
import { emptyMarks, type Marks, type PeekLine, type Tone } from "../facts/types";
import { see, unsafePieces, type BoardPiece } from "../review/safety";
import { buildVariation, type VariationMove } from "../variation";
import { kingZone } from "./geometry";
import { boardIdeas, nm } from "./ideas";
import { findThreat, gerund, moveLabel, type LineInput, type ThreatInfo } from "./reason";

export interface SacrificeStep {
  /** A short label: "If Black takes the rook", "Why not save the rook first?" */
  title: string;
  text: string;
  tone: Tone;
  marks: Marks;
  line?: PeekLine;
  lines?: PeekLine[];
}

export interface SacrificeExplanation {
  /** The whole idea in one or two sentences. */
  headline: string;
  steps: SacrificeStep[];
}

export interface SacrificeInput {
  /** Position before the move. */
  fen: string;
  uci: string;
  /** The engine's line from the position after the move (the opponent's best defence first). */
  reply?: LineInput;
  /** The engine's best and second-best lines before the move. */
  best?: LineInput;
  second?: LineInput;
  /** The opponent's threat before the move, if known (null: none). */
  threatBefore?: ThreatInfo | null;
  search: Searcher;
  depth?: number;
}

const clamp = (n: number) => Math.max(-3000, Math.min(3000, n));
const mvEval = (e: Evaluation, c: Color) => clamp(evalFor(e, c));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pieceWord = (t: string) => PIECE_NAME[t as keyof typeof PIECE_NAME] ?? t;
const valueOf = (t: string) => (t === "k" ? 100 : PIECE_VALUE[t as keyof typeof PIECE_VALUE]);
const GIFT: Record<string, string> = { q: "the queen", r: "a whole rook", b: "a bishop", n: "a knight", p: "a pawn" };
/** "the rook on a4", and "the pawn on g4" for pawns (the gift is named like a piece). */
const pieceOn = (p: Placement, sq: Square) => (p[sq]?.type === "p" ? `the pawn on ${sq}` : nm(p, sq));

/** A material balance in plain words: "a pawn", "a piece", "a rook's worth". */
function materialWords(n: number): string {
  const a = Math.abs(n);
  if (a === 1) return "a pawn";
  if (a === 2) return "two pawns";
  if (a === 3) return "a piece";
  if (a === 4) return "a piece and a pawn";
  if (a === 5) return "a rook's worth of material";
  if (a >= 8 && a <= 10) return "about a queen's worth of material";
  return `${a} points of material`;
}

/** The same position with `turn` to move (no en passant). */
function withTurn(fen: string, turn: Color): string {
  const parts = fen.split(" ");
  parts[1] = turn;
  parts[3] = "-";
  return parts.join(" ");
}

/** "is winning", "is clearly better", "is a little better", "holds the balance". */
function standing(e: Evaluation, me: Color): string {
  if (e.kind === "mate") return e.winner === me ? `forces mate in ${e.moves}` : `gets mated in ${e.moves}`;
  const v = evalFor(e, me);
  if (v >= 300) return "is winning";
  if (v >= 150) return "is clearly better";
  if (v >= 50) return "is a little better";
  if (v > -50) return "holds the balance";
  if (v > -150) return "is a little worse";
  if (v > -300) return "is clearly worse";
  return "is losing";
}

/** "winning", "clearly better", "a little better", "level", "worse": for "leaves White …". */
function standingAdj(e: Evaluation, me: Color): string {
  if (e.kind === "mate") return e.winner === me ? "mating" : "getting mated";
  const v = evalFor(e, me);
  if (v >= 300) return "winning";
  if (v >= 150) return "clearly better";
  if (v >= 50) return "a little better";
  if (v > -50) return "level";
  if (v > -150) return "a little worse";
  if (v > -300) return "clearly worse";
  return "losing";
}

/** Material for `me` at `fen`, counted from `base` (in pawns). */
function materialFrom(base: string, fen: string, me: Color): number {
  const d = materialSummary(placementFromFen(fen)).diff - materialSummary(placementFromFen(base)).diff;
  return me === "w" ? d : -d;
}

/** The point where a line has settled: not in the middle of an exchange, at most `max` plies. */
function settledEnd(moves: VariationMove[], max = 10): number {
  let end = Math.min(moves.length, max);
  while (end < moves.length && end < max + 4 && (moves[end - 1].captured || moves[end]?.captured)) end++;
  return end;
}

/** How a line ends, from `me`'s side: mate, material won or lost, or the engine's verdict. */
function outcome(baseFen: string, moves: VariationMove[], e: Evaluation, me: Color): string {
  if (!moves.length) return "";
  const end = settledEnd(moves);
  const last = moves[end - 1];
  if (last.san.includes("#")) return last.color === me ? "the line ends in checkmate" : `${COLOR_NAME[other(me)]} mates at the end of the line`;
  if (e.kind === "mate" && e.winner === me) return `${COLOR_NAME[me]} forces mate in ${e.moves}`;
  const m = materialFrom(baseFen, last.fenAfter, me);
  const verdict = `${COLOR_NAME[me]} ${standing(e, me)} (${formatEval(e)})`;
  if (m >= 1) return `${COLOR_NAME[me]} ends up ${materialWords(m)} ahead: ${verdict}`;
  if (m <= -1 && mvEval(e, me) >= 150) return `${COLOR_NAME[me]} is still ${materialWords(m)} down, but the attack is worth more: ${verdict}`;
  if (m <= -1) return `${COLOR_NAME[me]} is ${materialWords(m)} down: ${verdict}`;
  return `material is level and ${verdict}`;
}

/** Legal moves in `fen` that capture on `sq`. */
function capturesOn(fen: string, sq: Square): string[] {
  try {
    return new Chess(fen)
      .moves({ verbose: true })
      .filter((m) => m.to === sq)
      .map((m) => m.lan);
  } catch {
    return [];
  }
}

/** "the knight on c3 and the queen on d7" */
function listNames(p: Placement, squares: Square[]): string {
  const names = squares.map((s) => nm(p, s));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

/** Board ideas concrete enough to name in a line walk. */
const SHARP = new Set(["mate", "fork", "pin", "skewer", "attack", "king-attack", "promotion", "passed", "threat"]);

/** "winning the queen, picking it up with 32.dxc7" → "winning the queen": the follow-up belongs in the line, not the sentence. */
const plainWhy = (why: string) => why.replace(/, picking it up with .*$/, "").replace(/ once the captures settle/, "");

/** What a key move does: the threat it creates (engine), or its sharpest board idea. */
async function keyMovePoint(m: VariationMove, rest: VariationMove[], e: Evaluation, search: Searcher, depth: number): Promise<{ text: string; line?: PeekLine }> {
  const me = m.color;
  const taking = m.captured ? `taking ${nm(placementFromFen(m.fenBefore), m.to)}` : "";
  if (m.san.includes("#")) return { text: "and it's mate" };
  if (!m.isCheck) {
    const t = await findThreat(m.fenAfter, search, depth, e).catch(() => null);
    if (t) {
      const why = plainWhy(t.why);
      const threat = t.mates ? `threatening ${t.label} and mate` : `threatening ${t.label}${why ? `, ${why}` : ""}`;
      return { text: taking ? `${taking} and ${threat}` : threat, line: t.line };
    }
  }
  if (taking) return { text: m.isCheck ? `${taking} with check` : taking };
  if (m.isCheck) return { text: "" };
  const ideas = boardIdeas(m, { after: rest, evalAfter: mvEval(e, me), goodMove: true }).filter(
    (i) => i.tone !== "danger" && i.kind !== "development" && i.kind !== "defence" && i.kind !== "material",
  );
  const top = ideas[0];
  if (top) return { text: gerund(top.phrase.replace(/, picking it up with .*$/, "")) };
  return { text: "" };
}

/**
 * The rest of a line in plain words, after our first answer: our next forcing moves
 * (checks, mate threats, captures) and what the other side is forced to give up.
 * At most `probes` threat searches.
 */
async function walkLine(moves: VariationMove[], from: number, e: Evaluation, search: Searcher, depth: number, probes = 1, alreadySaid = ""): Promise<string> {
  // moves[0] is the explained move: its side is "us".
  const me = moves[0]?.color ?? "w";
  const end = settledEnd(moves);
  const said: string[] = [];
  for (let i = from; i < end && said.length < 2; i++) {
    const m = moves[i];
    if (m.color !== me) continue;
    if (m.san.includes("#")) {
      said.push(`${moveLabel(m)} is mate`);
      break;
    }
    if (m.promotion) {
      said.push(`${moveLabel(m)} makes a new ${pieceWord(m.promotion)}${m.isCheck ? " with check" : ""}`);
      continue;
    }
    if (m.isCheck) {
      said.push(`${moveLabel(m)} gives check`);
      continue;
    }
    // The same pawn running on: "the a-pawn runs on to a7".
    const prevSaid = said[said.length - 1];
    if (m.piece === "p" && prevSaid?.includes(`pushes the passed pawn`) && moves.slice(from, i).some((x) => x.color === me && x.piece === "p" && x.to[0] === m.to[0])) {
      said[said.length - 1] = `${prevSaid.replace(/ pushes the passed pawn to [a-h][1-8]/, "")}, and the ${m.to[0]}-pawn runs on to ${m.to}`;
      continue;
    }
    if (m.captured) {
      said.push(`${moveLabel(m)} takes ${nm(placementFromFen(m.fenBefore), m.to)}`);
      continue;
    }
    let t: ThreatInfo | null = null;
    if (probes > 0) {
      probes--;
      t = await findThreat(m.fenAfter, search, depth, e).catch(() => null);
    }
    if (t) {
      // The same threat again (a pinned piece, a piece still hanging) isn't news.
      const known = alreadySaid.includes(`threatening ${t.label}`) || said.some((x) => x.includes(`threatens ${t.label}`));
      if (!known) said.push(t.mates ? `${moveLabel(m)} threatens mate` : `${moveLabel(m)} threatens ${t.label}${plainWhy(t.why) ? `, ${plainWhy(t.why)}` : ""}`);
    } else {
      // No engine threat found (or no probe left): its sharpest concrete board idea, if any.
      const idea = boardIdeas(m, { after: moves.slice(i + 1), evalAfter: mvEval(e, me), goodMove: true }).find((x) => SHARP.has(x.kind) && x.tone !== "danger");
      if (idea) said.push(`${moveLabel(m)} ${idea.phrase.replace(/, picking it up with .*$/, "")}`);
    }
  }
  return said.length ? `Then ${said.join(", and ")}.` : "";
}

/** Did the walk already say the line ends in mate? */
const saysMate = (t: string) => / is mate\b/.test(t);

/**
 * The defensive jobs the captured piece was doing: squares next to its king that
 * nothing else guards now, and the colour of squares it leaves without a bishop.
 */
function removedDefender(fen: string, first: VariationMove): string | null {
  if (!first.captured) return null;
  const pb = placementFromFen(fen);
  const pa = placementFromFen(first.fenAfter);
  const them = other(first.color);
  const victim = pb[first.to];
  if (!victim || victim.type === "p") return null;
  const k = kingSquare(pa, them);
  const parts: string[] = [];
  if (k) {
    const guarded = attacksFrom(pb, first.to);
    const zone = kingZone(k).filter((s) => guarded.includes(s));
    const orphaned = zone.filter((s) => attackersOf(pa, s, them).filter((a) => pa[a]?.type !== "k").length === 0);
    if (orphaned.length >= 2) {
      const sq = orphaned.slice(0, 3);
      parts.push(`${nm(pb, first.to)} was the only piece guarding ${sq.length > 1 ? `${sq.slice(0, -1).join(", ")} and ${sq[sq.length - 1]}` : sq[0]} next to ${COLOR_NAME[them]}'s king`);
    }
  }
  if (victim.type === "b") {
    const light = isLightSquare(first.to);
    const left = piecesOf(pa, them).some(([s, x]) => x.type === "b" && isLightSquare(s) === light);
    const around = k ? kingZone(k).filter((s) => isLightSquare(s) === light && !pa[s]) : [];
    // Only worth saying when the king really has holes of that colour next to it.
    if (!left && around.length >= 2) parts.push(`${COLOR_NAME[them]} has no bishop left to guard the ${light ? "light" : "dark"} squares around the king (${around.slice(0, 3).join(", ")})`);
  }
  return parts.length ? parts.map(cap).join(". ") : null;
}

interface Option {
  /** The opponent's first move. */
  move: VariationMove;
  moves: VariationMove[];
  eval: Evaluation;
  pv: string[];
  /** What it takes, if anything. */
  takes?: BoardPiece;
  /** Takes back the piece that just captured. */
  takesBack: boolean;
}

export async function explainSacrifice(inp: SacrificeInput): Promise<SacrificeExplanation | null> {
  const { search } = inp;
  const depth = inp.depth ?? 14;
  // Probe budget: answers and the obvious move a little shallower than the review, threat probes shallower still.
  const lineDepth = Math.max(10, depth - 2);
  const threatDepth = Math.max(9, depth - 4);
  const first = buildVariation(inp.fen, [inp.uci], 1).moves[0];
  if (!first) return null;
  const me = first.color;
  const them = other(me);
  const Me = COLOR_NAME[me];
  const Them = COLOR_NAME[them];
  const after = first.fenAfter;
  const pb = placementFromFen(inp.fen);
  const pa = placementFromFen(after);
  const label = moveLabel(first);

  // What can they take? Our pieces they can win after the move, and the moved piece itself
  // even when it's a pawn (a pawn that offers itself is the gift).
  const hanging = unsafePieces(after, me).sort((a, b) => valueOf(b.type) - valueOf(a.type));
  const movedHangs = !hanging.some((h) => h.square === first.to) && capturesOn(after, first.to).length > 0 && see(pa, first.to, them, capturesOn(after, first.to).map((c) => c.slice(0, 2) as Square)) > 0;
  if (movedHangs) hanging.unshift({ square: first.to, type: first.piece, color: me });
  if (!hanging.length) return null;
  const before = unsafePieces(withTurn(inp.fen, them), me);
  const wasHanging = (pc: BoardPiece) => pc.square !== first.to && before.some((b) => b.square === pc.square && b.type === pc.type);
  // The material on offer: pieces other than the one that just captured (taking that back is a recapture, not a gift).
  const offered = hanging.filter((pc) => !(first.captured && pc.square === first.to));
  // The move's own offer comes first: the piece (or pawn) it puts where it can be taken.
  const gift = offered.find((pc) => pc.square === first.to) ?? offered[0] ?? hanging[0];
  const ignored = offered.find(wasHanging);

  // The opponent's realistic answers: every way of taking each hanging piece, plus their best move.
  const options: Option[] = [];
  const optionFor = async (pv: string[], e: Evaluation): Promise<Option | null> => {
    const moves = buildVariation(after, pv, 12).moves;
    const m = moves[0];
    if (!m) return null;
    const takes = hanging.find((h) => h.square === m.to);
    // "Taking back" is a recapture of about equal value; taking a rook that grabbed a pawn is accepting the sacrifice.
    const even = !!first.captured && valueOf(first.captured) >= valueOf(first.piece) - 1;
    return { move: m, moves, eval: e, pv, takes, takesBack: even && m.to === first.to };
  };
  for (const h of hanging.slice(0, 2)) {
    const caps = capturesOn(after, h.square);
    if (!caps.length) continue;
    const r = (await search({ fen: after, depth: lineDepth, multipv: 1, searchmoves: caps }))[0];
    const o = r && (await optionFor(r.pv, r.eval));
    if (o) options.push(o);
  }
  let bestReply = inp.reply?.pv.length ? await optionFor(inp.reply.pv, inp.reply.eval) : null;
  if (!bestReply) {
    const r = (await search({ fen: after, depth: lineDepth, multipv: 1 }))[0];
    bestReply = r ? await optionFor(r.pv, r.eval) : null;
  }
  if (bestReply && !options.some((o) => o.move.uci === bestReply!.move.uci)) options.push(bestReply);
  if (!options.length) return null;
  const bestEval = bestReply?.eval ?? options[0].eval;

  const steps: SacrificeStep[] = [];
  const arrow = (m: VariationMove, tone: "danger" | "opportunity" | "info", dashed = false) => ({ from: m.from, to: m.to, tone, dashed });

  // 1. What is given up.
  {
    const takers = attackersOf(pa, gift.square, them).filter((s) => capturesOn(after, gift.square).some((c) => c.startsWith(s)));
    const what = pieceOn(pa, gift.square);
    const by = takers.length ? ` to ${listNames(pa, takers)}` : "";
    const text = ignored
      ? `${cap(nm(pb, ignored.square))} is attacked${by ? ` by ${listNames(pa, takers)}` : ""}, and ${label} doesn't save it.`
      : gift.square === first.to
        ? `${label} puts ${what} where it can be taken${by ? ` by ${listNames(pa, takers)}` : ""}.`
        : `${label} leaves ${what} hanging${by}.`;
    steps.push({
      title: `What ${Me} gives up`,
      text: `${text} That's ${GIFT[gift.type] ?? "material"} on offer.`,
      tone: "info",
      marks: { ...emptyMarks(), squares: [{ sq: gift.square, tone: "opportunity", style: "pulse" }], arrows: takers.map((s) => ({ from: s, to: gift.square, tone: "danger" as const, dashed: true })) },
    });
  }

  // 2. What the move does instead.
  {
    const parts: string[] = [];
    if (first.captured) parts.push(`it takes ${nm(pb, first.to)}${ignored ? " first" : ""}`);
    else if (first.isCheck) parts.push("it gives check");
    // Taking a pawn, or a plain check, isn't a reason on its own: only say it with something more.
    const trivial = parts.length > 0 && (first.captured === "p" || (!first.captured && first.isCheck));
    const removed = removedDefender(inp.fen, first);
    if (removed) parts.push(removed);
    const threat = !first.isCheck && !first.captured ? await findThreat(after, search, threatDepth, bestEval).catch(() => null) : null;
    if (threat) parts.push(threat.mates ? `it threatens ${threat.label} and mate` : `it threatens ${threat.label}${plainWhy(threat.why) ? `, ${plainWhy(threat.why)}` : ""}`);
    const takeBoth = !!first.captured && hanging.some((h) => h.square === first.to) && offered.length > 0;
    if (takeBoth) parts.push(`now ${Them} can take only one of the two: the ${pieceWord(pa[first.to]!.type)} on ${first.to} or ${pieceOn(pa, gift.square)}`);
    if (parts.length && !(trivial && parts.length === 1))
      steps.push({
        title: "What it does instead",
        text: `${parts.map(cap).join(". ")}.`,
        tone: "opportunity",
        marks: { ...emptyMarks(), arrows: [arrow(first, "opportunity")] },
        line: threat?.line,
      });
  }

  // 3–4. Each answer, played out.
  const ordered = [...options].sort((a, b) => {
    // Taking the gift first (that's the question), then taking back, then anything else.
    const rank = (o: Option) => (o.takes && !o.takesBack ? 0 : o.takesBack ? 1 : 2);
    return rank(a) - rank(b) || mvEval(a.eval, them) - mvEval(b.eval, them);
  });
  const seenTargets = new Set<string>();
  for (const o of ordered.slice(0, 3)) {
    const key = o.takes ? o.takes.square : o.move.uci;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    const reply = o.moves[1];
    const theirLabel = moveLabel(o.move);
    const isBest = bestReply?.move.uci === o.move.uci;
    const title = o.takesBack
      ? `If ${Them} takes back on ${o.move.to}`
      : o.takes
        ? `If ${Them} takes ${pieceOn(pa, o.takes.square).replace(/ on [a-h][1-8]$/, "")}`
        : `${Them}'s best try`;
    const giftShort = pieceOn(pa, gift.square).replace(/ on [a-h][1-8]$/, "");
    let text = o.takes || o.takesBack ? `${theirLabel}` : `${Them}'s best is to leave ${giftShort} alone and play ${theirLabel}.`;
    if (reply) {
      const afterTheirs = o.move.fenAfter;
      // Does our answer rescue a piece that was hanging after their move?
      const stillHanging = unsafePieces(afterTheirs, me);
      const rescues = stillHanging.find((h) => h.square === reply.from);
      const point = await keyMovePoint(reply, o.moves.slice(2), o.eval, search, threatDepth);
      // A piece that escapes by capturing: the capture says enough.
      const rescueText = rescues && !reply.captured ? `, and ${nm(placementFromFen(afterTheirs), reply.from)} gets away` : "";
      const pointText = point.text ? (point.text === "and it's mate" ? ", and it's mate" : `, ${point.text}`) : "";
      text = o.takes || o.takesBack ? `${theirLabel} is met by ${moveLabel(reply)}${rescueText}${pointText}.` : `${text} ${Me} answers ${moveLabel(reply)}${rescueText}${pointText}.`;
      const walk = point.text === "and it's mate" ? "" : await walkLine([first, ...o.moves], 3, o.eval, search, threatDepth, 2, point.text);
      if (walk) text += ` ${walk}`;
      if (!saysMate(walk) && point.text !== "and it's mate") {
        const end = outcome(inp.fen, o.moves, o.eval, me);
        if (end) text += ` ${cap(end)}.`;
      }
      if (isBest && (o.takes || o.takesBack)) text += ` This is ${Them}'s best try.`;
      const shown = o.moves.slice(0, settledEnd(o.moves));
      steps.push({
        title,
        text,
        tone: "opportunity",
        marks: { ...emptyMarks(), arrows: [arrow(o.move, "danger"), arrow(reply, "opportunity")] },
        line: { fen: after, pv: shown.map((x) => x.uci), label: theirLabel },
        lines: [{ fen: after, pv: shown.map((x) => x.uci), label: theirLabel }, { fen: o.move.fenAfter, pv: shown.slice(1).map((x) => x.uci), label: moveLabel(reply) }],
      });
    }
  }

  // 5. Why not the obvious move?
  let obviousEval: Evaluation | null = null;
  {
    let obvious: { pv: string[]; eval: Evaluation; title: string } | null = null;
    if (ignored) {
      const saves = new Chess(inp.fen)
        .moves({ verbose: true })
        .filter((m) => m.from === ignored.square)
        .map((m) => m.lan)
        .filter((u) => u !== inp.uci);
      const title = `Why not save the ${pieceWord(ignored.type)} first?`;
      // The review's own second-best line is deeper (verified) than a fresh probe: use it when it saves the piece.
      const known = [inp.second, inp.best].find((l) => l && l.pv[0] !== inp.uci && saves.includes(l.pv[0]));
      if (known) obvious = { pv: known.pv, eval: known.eval, title };
      else if (saves.length) {
        // Full depth: this comparison is what convinces, and it's a single search.
        const r = (await search({ fen: inp.fen, depth, multipv: 1, searchmoves: saves }))[0];
        if (r) obvious = { pv: r.pv, eval: r.eval, title };
      }
    } else {
      const alt = inp.best && inp.best.pv[0] !== inp.uci ? inp.best : inp.second;
      if (alt && alt.pv[0] !== inp.uci) obvious = { pv: alt.pv, eval: alt.eval, title: "Without the sacrifice" };
    }
    if (obvious) {
      obviousEval = obvious.eval;
      const v = buildVariation(inp.fen, obvious.pv, 10).moves;
      const gap = mvEval(bestEval, me) - mvEval(obvious.eval, me);
      if (v[0] && gap >= 60) {
        const reply = v[1];
        let replyText = "";
        if (reply) {
          const point = await keyMovePoint(reply, v.slice(2), obvious.eval, search, threatDepth);
          replyText = ` ${Them} answers ${moveLabel(reply)}${point.text ? `, ${point.text}` : ""}.`;
        }
        const lead = ignored ? `Saving it with ${moveLabel(v[0])}, the best way to do that,` : `The best move without the sacrifice, ${moveLabel(v[0])},`;
        const ending =
          mvEval(obvious.eval, me) >= 150
            ? `${Me} would still be ${standingAdj(obvious.eval, me)}, but far less than after ${label}.`
            : `That would leave ${Me} ${standingAdj(obvious.eval, me)}.`;
        const text = `${lead} is clearly weaker (${formatEval(obvious.eval)} against ${formatEval(bestEval)}).${replyText} ${ending}`;
        steps.push({
          title: obvious.title,
          text,
          tone: "info",
          marks: { ...emptyMarks(), arrows: [arrow(v[0], "info", true), ...(reply ? [arrow(reply, "danger")] : [])] },
          line: { fen: inp.fen, pv: v.slice(0, settledEnd(v, 8)).map((x) => x.uci), label: moveLabel(v[0]) },
        });
      }
    }
  }

  return { headline: headlineFor(), steps };

  function headlineFor(): string {
    // A defensive sacrifice: not good for us, but far better than anything else.
    if (mvEval(bestEval, me) < 50 && obviousEval && mvEval(obviousEval, me) <= mvEval(bestEval, me) - 150) {
      return `${label}!! gives up ${pieceOn(pa, gift.square)} to stay in the game: after it ${Me} ${standing(bestEval, me)} (${formatEval(bestEval)}); anything else leaves ${Me} ${standingAdj(obviousEval, me)} (${formatEval(obviousEval)}).`;
    }
    const takeOpt = options.find((o) => o.takes && !o.takesBack);
    const backOpt = options.find((o) => o.takesBack);
    const giftName = pieceOn(pa, gift.square);
    const take = takeOpt ? outcomeShort(takeOpt) : "";
    if (ignored && first.captured) {
      const both = backOpt && takeOpt;
      return `${label}!! ignores the attack on ${nm(pb, ignored.square)} and takes ${nm(pb, first.to)} first.${both ? ` ${Them} can take only one of the two, and either way ${Me} ${standing(bestEval, me)}.` : take ? ` Taking the ${pieceWord(gift.type)} ${take}.` : ""}`;
    }
    if (gift.square === first.to) return `${label}!! offers ${giftName}.${take ? ` Taking it ${take}.` : ` ${Me} ${standing(bestEval, me)} even so.`}`;
    return `${label}!! leaves ${giftName} hanging.${take ? ` Taking it ${take}.` : ` ${Me} ${standing(bestEval, me)} even so.`}`;
  }

  function outcomeShort(o: Option): string {
    const end = settledEnd(o.moves);
    const last = o.moves[end - 1];
    if ((last && last.san.includes("#") && last.color === me) || (o.eval.kind === "mate" && o.eval.winner === me)) return "leads to mate";
    if (o.moves.slice(0, end).some((x) => x.color === me && x.promotion)) return `lets ${Me}'s pawn become a queen`;
    const m = last ? materialFrom(inp.fen, last.fenAfter, me) : 0;
    if (m >= 0) return `gives ${Me} the material back and more`;
    if (mvEval(o.eval, me) >= 150) return `gives ${Me} an attack worth more than the ${pieceWord(gift.type)}`;
    return `still leaves ${Me} ${standingAdj(o.eval, me)}`;
  }
}

