import { ALL_SQUARES, isLightSquare } from "../chess/board";
import { PIECE_VALUE, type Color, type PieceSymbol, type Placement, type Square } from "../chess/types";
import { type Ctx } from "./context";
import { emptyMarks, type Fact } from "./types";

export const MATERIAL_ORDER: PieceSymbol[] = ["q", "r", "b", "n", "p"];

export interface MaterialSide {
  counts: Record<PieceSymbol, number>;
  points: number;
}

export interface MaterialSummary {
  w: MaterialSide;
  b: MaterialSide;
  /** White points minus Black points. */
  diff: number;
  imbalances: string[];
}

function side(p: Placement, c: Color): MaterialSide {
  const counts: Record<PieceSymbol, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  for (const sq of ALL_SQUARES) {
    const x = p[sq];
    if (x?.color === c) counts[x.type]++;
  }
  const points = MATERIAL_ORDER.reduce((s, t) => s + counts[t] * PIECE_VALUE[t], 0);
  return { counts, points };
}

export function materialSummary(p: Placement): MaterialSummary {
  const w = side(p, "w");
  const b = side(p, "b");
  const imbalances: string[] = [];
  const minors = (s: MaterialSide) => s.counts.n + s.counts.b;
  const name = (c: Color) => (c === "w" ? "White" : "Black");

  for (const [c, me, them] of [["w", w, b], ["b", b, w]] as [Color, MaterialSide, MaterialSide][]) {
    if (me.counts.b >= 2 && them.counts.b < 2) imbalances.push(`${name(c)} has the bishop pair`);
    if (me.counts.r > them.counts.r && minors(them) > minors(me) && me.counts.r - them.counts.r === minors(them) - minors(me))
      imbalances.push(`${name(c)} has a rook against a minor piece (the exchange)`);
    if (me.counts.q > them.counts.q && them.counts.r + minors(them) > me.counts.r + minors(me))
      imbalances.push(`${name(c)} has a queen against extra pieces`);
    if (minors(me) > minors(them) && me.counts.r === them.counts.r && me.counts.q === them.counts.q && them.counts.p > me.counts.p)
      imbalances.push(`${name(c)} has a piece against pawns`);
  }
  const wb = ALL_SQUARES.filter((s) => p[s]?.type === "b" && p[s]?.color === "w");
  const bb = ALL_SQUARES.filter((s) => p[s]?.type === "b" && p[s]?.color === "b");
  if (wb.length === 1 && bb.length === 1 && isLightSquare(wb[0]) !== isLightSquare(bb[0]))
    imbalances.push("Opposite-coloured bishops");
  if (w.counts.p !== b.counts.p) {
    const more = w.counts.p > b.counts.p ? "White" : "Black";
    const n = Math.abs(w.counts.p - b.counts.p);
    imbalances.push(`${more} has ${n} more pawn${n > 1 ? "s" : ""}`);
  }
  return { w, b, diff: w.points - b.points, imbalances };
}

export function materialFacts(ctx: Ctx): Fact[] {
  const { p } = ctx;
  const m = materialSummary(p);
  const facts: Fact[] = [];
  const leader: Color = m.diff >= 0 ? "w" : "b";
  const pieceSquares = (types: PieceSymbol[], c?: Color): Square[] =>
    ALL_SQUARES.filter((s) => p[s] && types.includes(p[s]!.type) && (!c || p[s]!.color === c));

  facts.push({
    id: "material-balance",
    lens: "material",
    kind: "balance",
    side: leader,
    tone: m.diff === 0 ? "info" : "opportunity",
    anchor: pieceSquares(["q", "r", "b", "n", "p"], leader)[0] ?? "e4",
    title:
      m.diff === 0
        ? `Material is level: ${m.w.points} points each.`
        : `${leader === "w" ? "White" : "Black"} is up ${Math.abs(m.diff)} point${Math.abs(m.diff) > 1 ? "s" : ""} of material (${m.w.points} v ${m.b.points}).`,
    detail: "Counting pawn 1, knight 3, bishop 3, rook 5, queen 9. The engine's evaluation includes much more than this.",
    evidence: "rules",
    marks: emptyMarks(),
    priority: 50,
  });
  m.imbalances.forEach((text, i) => {
    const highlight: Square[] = /bishop/i.test(text)
      ? pieceSquares(["b"])
      : /exchange|rook/.test(text)
        ? pieceSquares(["r", "n", "b"])
        : /queen/.test(text)
          ? pieceSquares(["q"])
          : [];
    facts.push({
      id: `imbalance-${i}`,
      lens: "material",
      kind: "imbalance",
      side: /^Black/.test(text) ? "b" : "w",
      tone: "info",
      anchor: highlight[0] ?? "e4",
      title: `${text}.`,
      evidence: "rules",
      marks: { ...emptyMarks(), squares: highlight.map((s) => ({ sq: s, tone: "info" as const, style: "ring" as const })) },
      priority: 40 - i,
    });
  });
  return facts;
}
