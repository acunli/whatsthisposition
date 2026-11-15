/**
 * What kind of position is this? A handful of labels, each with what it means for how the
 * position is played: the phase (and, in an endgame, which endgame), the centre, the pawn
 * structure when it has a name, where the kings are, how sharp it is, and what the two
 * sides are playing with.
 */
import { isLightSquare } from "../chess/board";
import { COLOR_NAME, other, type Color, type Square } from "../chess/types";
import { evalFor, type Evaluation } from "../engine/score";
import type { PositionFacts } from "../facts";
import { emptyMarks, type Marks } from "../facts/types";
import { buildVariation } from "../variation";
import { fileLetter, materialWords, type Features } from "./features";
import type { Structure } from "./structures";
import type { PositionType } from "./types";

export interface EngineRead {
  lines: { pv: string[]; eval: Evaluation; depth?: number }[];
}

const win = (cp: number) => 1 / (1 + Math.exp(-0.00368208 * cp));
const clampCp = (e: Evaluation, c: Color) => Math.max(-2000, Math.min(2000, evalFor(e, c)));
const bands = (files: number[], tone: "info" | "danger" | "opportunity" = "info"): Marks => ({ ...emptyMarks(), bands: files.map((index) => ({ kind: "file" as const, index, tone })) });
const rings = (sqs: Square[], tone: "info" | "danger" | "opportunity" = "info"): Marks => ({ ...emptyMarks(), squares: sqs.map((sq) => ({ sq, tone, style: "ring" as const })) });

function phaseType(f: Features): PositionType {
  const base = { group: "phase" as const, marks: emptyMarks() };
  if (f.phase === "opening")
    return { ...base, id: "opening", name: "Opening", meaning: "Pieces are still coming out. A piece developed, a safe king and a share of the centre are worth more than a pawn won on the side." };
  if (f.phase === "middlegame") return { ...base, id: "middlegame", name: "Middlegame", meaning: "Development is over; the plans now come from the pawn structure and the kings." };
  if (f.phase === "queenless")
    return {
      ...base,
      id: "queenless",
      name: "Queenless middlegame",
      meaning: "The queens are off but most of the pieces are still on. Kings are much safer and can come towards the centre; pawn structure and the activity of each piece count for more than attack.",
    };
  // Which endgame.
  const kinds = (c: Color) => {
    const s = f.of(c).counts;
    return { q: s.q, r: s.r, b: s.b, n: s.n };
  };
  const w = kinds("w");
  const b = kinds("b");
  const total = { q: w.q + b.q, r: w.r + b.r, b: w.b + b.b, n: w.n + b.n };
  const minors = total.b + total.n;
  if (!total.q && !total.r && !minors)
    return { ...base, id: "eg-pawn", name: "Pawn endgame", meaning: "Only kings and pawns. The more active king and a spare tempo decide; nothing can be taken back, so it has to be counted move by move." };
  if (!total.q && total.r && !minors)
    return {
      ...base,
      id: "eg-rook",
      name: total.r > 2 ? "Double-rook endgame" : "Rook endgame",
      meaning: "An active rook is worth more than a pawn here. Rooks belong behind passed pawns, the king in front of its own pawns, and the passive side usually loses.",
    };
  if (total.q && total.r && !minors)
    return {
      ...base,
      id: "eg-heavy",
      name: "Queen and rook endgame",
      meaning: "Only heavy pieces are left, so king safety still decides: an exposed king costs more than a pawn. Passed pawns are strong, because a queen or rook that has to block one is wasted.",
    };
  if (total.q && !total.r && !minors)
    return { ...base, id: "eg-queen", name: "Queen endgame", meaning: "Passed pawns and checks decide. A far-advanced pawn outweighs extra pawns elsewhere, and the defender's hope is perpetual check." };
  if (!total.q && !total.r && total.n && !total.b)
    return { ...base, id: "eg-knight", name: "Knight endgame", meaning: "Knight endings play much like pawn endings: an extra pawn or an outside passed pawn usually wins, because a knight is slow to cross the board." };
  if (!total.q && !total.r && total.b && !total.n) {
    const wb = f.w.bishops[0];
    const bb = f.b.bishops[0];
    if (f.w.bishops.length === 1 && f.b.bishops.length === 1 && isLightSquare(wb) !== isLightSquare(bb))
      return {
        ...base,
        id: "eg-ocb",
        name: "Opposite-coloured bishops",
        phrase: "an endgame with opposite-coloured bishops",
        meaning: "The bishops can never meet. The defender sets up on the squares the other bishop can't touch, and is often safe even a pawn or two down; winning needs passed pawns far apart.",
      };
    return { ...base, id: "eg-bishop", name: "Bishop endgame", meaning: "Keep pawns on the colour your bishop doesn't use, so it stays free and they stay safe. The better king and an outside passed pawn decide." };
  }
  if (!total.q && !total.r && w.b + w.n === 1 && b.b + b.n === 1)
    return {
      ...base,
      id: "eg-bn",
      name: "Bishop against knight",
      phrase: "an endgame of bishop against knight",
      meaning: "The bishop wants pawns on both wings and open diagonals; the knight wants everything on one side, a fixed structure and a square no pawn can take from it.",
    };
  if (!total.q && total.r && minors)
    return { ...base, id: "eg-rook-minor", name: "Rook and minor-piece endgame", meaning: "Enough pieces remain for the more active side to press. The kings can come forward, and each trade changes which endgame it becomes: decide which one suits you before swapping." };
  return { ...base, id: "endgame", name: "Endgame", meaning: "Few pieces are left, so the king is a fighting piece and belongs in the middle; passed pawns grow in value with every trade." };
}

function centreType(f: Features): PositionType | null {
  if (f.phase === "endgame") return null;
  const c = f.centre;
  const base = { group: "centre" as const };
  const lockedMarks = (): Marks => ({ ...emptyMarks(), squares: c.locked.flatMap((file) => f.ctx.p && centrePawns(f, file)).map((sq) => ({ sq, tone: "info" as const, style: "ring" as const })) });
  switch (c.kind) {
    case "closed":
      return { ...base, id: "centre-closed", name: "Closed centre", meaning: "The d- and e-pawns block each other, so the middle stays shut and the play goes to the wings. There is time to manoeuvre; pawn breaks decide where the lines open.", marks: lockedMarks() };
    case "open":
      return {
        ...base,
        id: "centre-open",
        name: "Open centre",
        meaning: "Almost no pawns are left in the middle. Pieces meet at once, so development, open files and king safety matter more than the pawn structure, and bishops outrange knights.",
        marks: bands([3, 4]),
      };
    case "mobile": {
      const s = c.mobileSide!;
      const sqs = centrePawnsOf(f, s);
      return {
        ...base,
        id: "centre-mobile",
        name: "Mobile pawn centre",
        side: s,
        meaning: `${COLOR_NAME[s]} has two pawns abreast in the centre and nothing blocks them. If they can advance they cramp ${COLOR_NAME[other(s)]}'s pieces; if they are pinned down and attacked they become targets. ${COLOR_NAME[other(s)]} has to hit them with pawns and pieces before they roll.`,
        marks: rings(sqs, "opportunity"),
      };
    }
    case "tension": {
      const sqs = [...new Set(c.contacts.flat())];
      return {
        ...base,
        id: "centre-tension",
        name: "Tension in the centre",
        meaning: "Centre pawns can capture each other and nobody has yet. Taking usually helps the other side's pieces; holding the tension keeps both options open. Who releases it, and when, shapes the game.",
        marks: rings(sqs),
      };
    }
    case "fixed":
      return {
        ...base,
        id: "centre-fixed",
        name: "Fixed centre",
        meaning: `The pawns on the ${c.locked.map(fileLetter).join("- and ")}-file block each other and won't move for a long time, so the weak squares and the open files are known in advance. Plans are slow and aimed at those.`,
        marks: lockedMarks(),
      };
    default:
      return { ...base, id: "centre-semi", name: "Half-open centre", meaning: "Some centre pawns have been traded and files are opening. Rooks want those files, and the side that controls the middle squares with pieces gets the freer game.", marks: emptyMarks() };
  }
}

const centrePawns = (f: Features, file: number): Square[] => (["w", "b"] as Color[]).flatMap((c) => centrePawnsOf(f, c).filter((s) => s[0] === fileLetter(file)));
const centrePawnsOf = (f: Features, c: Color): Square[] => f.of(c).pawns.map((x) => x.sq).filter((s) => s[0] === "d" || s[0] === "e");

function kingsType(f: Features): PositionType | null {
  if (f.phase === "endgame" || !f.queensOn) return null;
  const { w, b } = f;
  if (w.castled && b.castled && w.kingWing !== b.kingWing)
    return {
      id: "kings-opposite",
      group: "kings",
      name: "Opposite-side castling",
      meaning: "The kings are on different wings, so each side can throw the pawns in front of the enemy king forward without loosening its own. It becomes a race, and a tempo is worth more than a pawn.",
      marks: rings([w.king, b.king], "danger"),
    };
  for (const [me, them] of [[w, b], [b, w]] as const) {
    const stuck = !me.castled && me.kingWing === "centre";
    if (!stuck || f.fullmove < 9) continue;
    const can = me.canCastle.k || me.canCastle.q;
    if (can && !them.castled) continue;
    return {
      id: `king-centre-${me.color}`,
      group: "kings",
      side: me.color,
      name: can ? "King still in the centre" : "King stuck in the centre",
      meaning: can
        ? `${COLOR_NAME[me.color]} hasn't castled yet while ${COLOR_NAME[them.color]} has. Until it does, ${COLOR_NAME[them.color]} gains from every centre file that opens.`
        : `${COLOR_NAME[me.color]}'s king can no longer castle. With queens on, it is a target for as long as it stays in the middle, and its rooks struggle to connect.`,
      marks: rings([me.king], "danger"),
    };
  }
  return null;
}

const TACTIC_KINDS = new Set(["hanging", "attacked-by-cheaper", "fork", "fork-move", "skewer", "discovery", "back-rank", "mate-in-one", "overloaded"]);

function characterType(f: Features, facts: PositionFacts, structures: Structure[], engine?: EngineRead): PositionType | null {
  const lines = engine?.lines ?? [];
  if (lines[0]?.eval.kind === "mate") return null;
  const decided = !!lines[0] && Math.abs(clampCp(lines[0].eval, "w")) >= 450;
  if (lines.length >= 2) {
    const a = clampCp(lines[0].eval, f.turn);
    const b = clampCp(lines[1].eval, f.turn);
    const first = buildVariation(f.fen, lines[0].pv, 1).moves[0];
    // One move keeps something the others lose: measured as winning chances, so +9 against +7 doesn't count.
    if (first && win(a) - win(b) >= 0.15) {
      const num = first.color === "w" ? `${first.moveNumber}.` : `${first.moveNumber}…`;
      return {
        id: "critical",
        group: "character",
        name: "Critical moment",
        meaning: `One move stands apart here: ${num}${first.san}. The next best is about ${((a - b) / 100).toFixed(1)} pawns worse, so this is a position to calculate, not to play on principle.`,
        marks: { ...emptyMarks(), arrows: [{ from: first.from, to: first.to, tone: "opportunity" }] },
      };
    }
  }
  const loud = facts.byLens.threats.filter((x) => TACTIC_KINDS.has(x.kind));
  if (loud.length >= 3 || f.ctx.inCheck)
    return {
      id: "tactical",
      group: "character",
      name: "Tactical position",
      meaning: "Pieces are attacked or loose on both sides. Concrete lines come before general ideas here: check every capture and check before choosing a plan.",
      marks: { ...emptyMarks(), squares: loud.slice(0, 4).map((x) => ({ sq: x.anchor, tone: "danger" as const, style: "ring" as const })) },
    };
  if (decided) return null;
  const chain = structures.find((s) => s.id === "chain")?.chain;
  if (chain && f.queensOn && f.phase !== "endgame" && chain.w.wing !== chain.b.wing && (f.b.kingWing === chain.w.wing || f.w.kingWing === chain.b.wing))
    return {
      id: "race",
      group: "character",
      name: "Race on opposite wings",
      meaning: "Each side attacks where its pawns point and can barely defend where the other's do. Moves spent on defence are moves lost; what counts is who opens a file first, and an attack on a king beats an attack on pawns.",
      marks: emptyMarks(),
    };
  if ((f.phase === "middlegame" || f.phase === "queenless") && !loud.length && (f.centre.kind === "closed" || f.centre.kind === "fixed"))
    return {
      id: "manoeuvring",
      group: "character",
      name: "Manoeuvring game",
      meaning: "Nothing is attacked and the centre isn't going anywhere. The side that finds better squares for its pieces, one at a time, comes out ahead when the position finally opens.",
      marks: emptyMarks(),
    };
  if (lines.length >= 3) {
    const a = clampCp(lines[0].eval, f.turn);
    const c = clampCp(lines[2].eval, f.turn);
    if (a - c <= 25 && !loud.length)
      return {
        id: "quiet",
        group: "character",
        name: "Several good moves",
        meaning: "The engine's top choices are within a quarter of a pawn of each other. No single move has to be found: pick the one that fits the plan you want.",
        marks: emptyMarks(),
      };
  }
  return null;
}

function balanceTypes(f: Features, engine?: EngineRead): PositionType[] {
  const out: PositionType[] = [];
  const mw = materialWords(f);
  const best = engine?.lines[0]?.eval;
  if (f.phase !== "endgame" && f.w.bishops.length === 1 && f.b.bishops.length === 1 && isLightSquare(f.w.bishops[0]) !== isLightSquare(f.b.bishops[0]))
    out.push({
      id: "ocb",
      group: "balance",
      name: "Opposite-coloured bishops",
      meaning: "With other pieces on the board this favours whoever is attacking: the attacker's bishop hits squares the defender's bishop can never cover. In a pure bishop ending the same thing points to a draw.",
      marks: rings([f.w.bishops[0], f.b.bishops[0]]),
    });
  if (f.phase === "endgame") {
    const files = [...f.w.pawns, ...f.b.pawns].map((x) => x.sq.charCodeAt(0) - 97);
    if (files.length >= 3 && Math.max(...files) - Math.min(...files) <= 3 && (Math.max(...files) <= 3 || Math.min(...files) >= 4))
      out.push({
        id: "one-wing",
        group: "balance",
        name: "Pawns on one wing",
        meaning: "All the pawns are on the same side of the board, so the defending king is always close to them and nothing can be created far away. An extra pawn is often not enough to win here.",
        marks: emptyMarks(),
      });
  }
  if (mw && mw.mixed)
    out.push({
      id: "imbalance",
      group: "balance",
      side: mw.side,
      name: "Unbalanced material",
      meaning: `${COLOR_NAME[mw.side]} has ${mw.text}. Different pieces want different positions: rooks and queens need open files, minor pieces need squares no pawn can take away. Each side should steer for the kind of position its own pieces like.`,
      marks: emptyMarks(),
    });
  if (best && best.kind === "mate" && best.moves > 0)
    out.push({
      id: "mate",
      group: "balance",
      side: best.winner,
      name: `Mate in ${best.moves}`,
      meaning: `${COLOR_NAME[best.winner]} has a forced mate. Everything else about the position stops mattering: the only question is finding the moves.`,
      marks: emptyMarks(),
    });
  else if (best && Math.abs(clampCp(best, "w")) >= 450) {
    const winner: Color = clampCp(best, "w") > 0 ? "w" : "b";
    out.push({
      id: "won",
      group: "balance",
      side: winner,
      name: "Winning position",
      meaning: `With accurate play ${COLOR_NAME[winner]} wins this. What is left is technique: keep it simple, trade pieces, and don't allow counterplay. ${COLOR_NAME[other(winner)]}'s only chances are tricks and complications.`,
      marks: emptyMarks(),
    });
  }
  if (mw && best && mw.points >= 1) {
    const behind = other(mw.side);
    const cp = clampCp(best, behind);
    if (cp >= -40)
      out.push({
        id: "compensation",
        group: "balance",
        side: behind,
        name: "Compensation",
        meaning: `${COLOR_NAME[mw.side]} is ${mw.text}, but the engine doesn't think ${COLOR_NAME[mw.side]} is better for it. ${COLOR_NAME[behind]} has something in return, and it tends to be the kind of thing that fades: it has to be used before the position settles.`,
        marks: emptyMarks(),
      });
  }
  return out;
}

export function positionTypes(f: Features, structures: Structure[], facts: PositionFacts, engine?: EngineRead): PositionType[] {
  const out: PositionType[] = [phaseType(f)];
  const named = structures.filter((s) => s.id !== "majorities" || f.phase === "endgame" || f.phase === "queenless").slice(0, 2);
  // A named structure says more than the centre's general type; show the centre only when it adds something.
  const centre = centreType(f);
  const coveredByStructure = named.some((s) => s.id === "chain" || s.id === "carlsbad") && centre && (centre.id === "centre-closed" || centre.id === "centre-fixed");
  if (centre && !coveredByStructure) out.push(centre);
  for (const s of named) out.push({ id: `structure-${s.id}-${s.side}`, group: "structure", name: s.name, phrase: s.phrase, meaning: s.meaning, marks: s.marks, side: s.id === "chain" || s.id === "symmetrical" || s.id === "majorities" ? undefined : s.side });
  const kings = kingsType(f);
  if (kings) out.push(kings);
  out.push(...balanceTypes(f, engine));
  const character = characterType(f, facts, structures, engine);
  if (character) out.push(character);
  return out;
}
