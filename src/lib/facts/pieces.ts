/**
 * Piece-level strengths and weaknesses: dominant pieces, the worst piece on each side
 * (Silman's "improve your worst piece"), rooks on the seventh, knights on the rim.
 */
import { ALL_SQUARES, fileIndex, rankIndex } from "../chess/board";
import { PIECE_NAME, type Color, type Square } from "../chess/types";
import { safeMobility } from "./activity";
import { describe, sideName, type Ctx } from "./context";
import { emptyMarks, type Fact, type Marks, type Tone } from "./types";

const dist = (a: Square, b: Square) => Math.max(Math.abs(fileIndex(a) - fileIndex(b)), Math.abs(rankIndex(a) - rankIndex(b)));

/** Squares a piece covers, flooded outward from the piece in its side's colour. */
export function dominanceMarks(ctx: Ctx, sq: Square, tone?: Tone): Marks {
  const piece = ctx.p[sq];
  const marks = emptyMarks();
  if (!piece) return marks;
  const t: Tone = tone ?? (piece.color === "w" ? "white" : "black");
  const covered = [...ctx.attacks(sq)].sort((a, b) => dist(sq, a) - dist(sq, b));
  covered.forEach((s, i) => marks.squares.push({ sq: s, tone: t, style: "flood", order: i }));
  marks.squares.push({ sq, tone: "opportunity", style: "ring" });
  return marks;
}

export interface Mobility {
  sq: Square;
  safe: Square[];
  covered: number;
}

export function mobilityOf(ctx: Ctx, color: Color): Mobility[] {
  return ALL_SQUARES.filter((s) => {
    const x = ctx.p[s];
    return x && x.color === color && ["n", "b", "r", "q"].includes(x.type);
  }).map((sq) => ({ sq, safe: safeMobility(ctx.p, sq, ctx.attacks(sq)), covered: ctx.attacks(sq).length }));
}

/** Mobility relative to what that piece type typically has, so a queen isn't always "best". */
const TYPICAL: Record<string, number> = { n: 5, b: 7, r: 8, q: 14 };

export function pieceFacts(ctx: Ctx): Fact[] {
  const { p } = ctx;
  const facts: Fact[] = [];
  for (const c of ["w", "b"] as Color[]) {
    const mob = mobilityOf(ctx, c);
    if (!mob.length) continue;
    const score = (m: Mobility) => m.safe.length / TYPICAL[p[m.sq]!.type];
    const ranked = [...mob].sort((a, b) => score(b) - score(a));
    const best = ranked[0];
    const home = c === "w" ? 0 : 7;
    const candidates = ranked.filter((m) => {
      const x = p[m.sq]!;
      if ((x.type === "r" || x.type === "q") && rankIndex(m.sq) === home) return false;
      if ((x.type === "n" || x.type === "b") && rankIndex(m.sq) === home) return false; // "undeveloped" covers these
      return true;
    });
    const worst = candidates[candidates.length - 1] ?? best;
    if (score(best) >= 1.1) {
      facts.push({
        id: `star-${best.sq}`,
        lens: "activity",
        kind: "dominant-piece",
        side: c,
        tone: "opportunity",
        anchor: best.sq,
        title: `${describe(p, best.sq)} is ${sideName(c)}'s most active piece: ${best.safe.length} safe squares, ${best.covered} controlled.`,
        evidence: "rules",
        label: `Active ${PIECE_NAME[p[best.sq]!.type]} ${best.sq}`,
        polarity: "strength",
        marks: { ...dominanceMarks(ctx, best.sq), icons: [{ sq: best.sq, icon: "star", tone: "opportunity" }] },
        priority: 52,
      });
    }
    if (mob.length > 1 && worst !== best && score(worst) <= 0.45) {
      facts.push({
        id: `worst-${worst.sq}`,
        lens: "activity",
        kind: "worst-piece",
        side: c,
        tone: "danger",
        anchor: worst.sq,
        title: `${describe(p, worst.sq)} is ${sideName(c)}'s worst piece, with ${worst.safe.length} safe square${worst.safe.length === 1 ? "" : "s"}. Improving it is a plan in itself.`,
        detail: "A classic rule of thumb: when you don't know what to do, find your worst piece and give it a better job.",
        evidence: "rules",
        label: `Passive ${PIECE_NAME[p[worst.sq]!.type]} ${worst.sq}`,
        polarity: "weakness",
        marks: {
          ...emptyMarks(),
          squares: [{ sq: worst.sq, tone: "danger", style: "pulse" }, ...worst.safe.map((s) => ({ sq: s, tone: "info" as const, style: "dot" as const }))],
          icons: [{ sq: worst.sq, icon: "lock", tone: "danger" }],
        },
        priority: 50,
      });
    }

    // Rooks on the seventh (the opponent's second rank)
    const seventh = c === "w" ? 6 : 1;
    for (const sq of ALL_SQUARES) {
      const x = p[sq];
      if (x?.type !== "r" || x.color !== c || rankIndex(sq) !== seventh) continue;
      facts.push({
        id: `seventh-${sq}`,
        lens: "activity",
        kind: "seventh-rank",
        side: c,
        tone: "opportunity",
        anchor: sq,
        title: `${describe(p, sq)} has reached the 7th rank, where it attacks pawns from behind and hems in the king.`,
        evidence: "rules",
        label: `Rook on the 7th`,
        polarity: "strength",
        marks: { ...emptyMarks(), bands: [{ kind: "rank", index: seventh, tone: "opportunity" }], squares: [{ sq, tone: "opportunity", style: "ring" }] },
        priority: 57,
      });
    }

    // Knights on the rim
    for (const sq of ALL_SQUARES) {
      const x = p[sq];
      if (x?.type !== "n" || x.color !== c) continue;
      if (fileIndex(sq) !== 0 && fileIndex(sq) !== 7) continue;
      const home = c === "w" ? rankIndex(sq) === 0 : rankIndex(sq) === 7;
      if (home) continue;
      facts.push({
        id: `rim-${sq}`,
        lens: "activity",
        kind: "knight-rim",
        side: c,
        tone: "danger",
        anchor: sq,
        title: `${describe(p, sq)} is on the rim, covering only ${ctx.attacks(sq).length} squares ("a knight on the rim is dim").`,
        evidence: "rules",
        label: `Knight on the rim`,
        polarity: "weakness",
        marks: dominanceMarks(ctx, sq, "danger"),
        priority: 38,
      });
    }
  }
  return facts;
}
