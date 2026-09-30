/** "Tap a piece" tracing: what a piece attacks and defends, and who attacks and defends it. */
import { other, type Square } from "../chess/types";
import { describe, enPrise, safeSquares, sideName, tag, type Ctx } from "./context";
import { emptyMarks, type Marks } from "./types";

export interface Trace {
  sq: Square;
  lines: string[];
  marks: Marks;
}

export function traceSquare(ctx: Ctx, sq: Square): Trace {
  const { p } = ctx;
  const piece = p[sq];
  const marks = emptyMarks();
  marks.squares.push({ sq, tone: "info", style: "ring" });

  if (!piece) {
    const w = ctx.attackers(sq, "w");
    const b = ctx.attackers(sq, "b");
    w.forEach((a) => marks.arrows.push({ from: a, to: sq, tone: "white", thin: true }));
    b.forEach((a) => marks.arrows.push({ from: a, to: sq, tone: "black", thin: true }));
    const fmt = (xs: Square[]) => (xs.length ? xs.map((x) => tag(p, x)).join(", ") : "none");
    return {
      sq,
      lines: [`${sq}: White ${w.length} (${fmt(w)}) · Black ${b.length} (${fmt(b)})`],
      marks,
    };
  }

  const enemy = other(piece.color);
  const reach = ctx.attacks(sq);
  const attacked = reach.filter((t) => p[t]?.color === enemy);
  const defended = reach.filter((t) => p[t]?.color === piece.color);
  const attackers = ctx.attackers(sq, enemy);
  const defenders = ctx.attackers(sq, piece.color);

  reach.filter((t) => !p[t]).forEach((t) => marks.squares.push({ sq: t, tone: "info", style: "dot" }));
  attacked.forEach((t) => {
    marks.arrows.push({ from: sq, to: t, tone: "opportunity" });
    marks.squares.push({ sq: t, tone: "opportunity", style: "ring" });
  });
  defended.forEach((t) => marks.arrows.push({ from: sq, to: t, tone: "info", thin: true, dashed: true }));
  attackers.forEach((a) => marks.arrows.push({ from: a, to: sq, tone: "danger" }));
  defenders.forEach((d) => marks.arrows.push({ from: d, to: sq, tone: "info", thin: true }));

  const lines = [`${describe(p, sq)}`];
  lines.push(
    attacked.length ? `Attacks ${attacked.map((t) => tag(p, t)).join(", ")}.` : "Attacks no enemy piece.",
  );
  if (defended.length) lines.push(`Defends ${defended.map((t) => tag(p, t)).join(", ")}.`);
  if (piece.type !== "k") {
    lines.push(
      `Attacked by ${attackers.length} (${sideName(enemy)}), defended by ${defenders.length}.`,
    );
  }
  const pin = ctx.pins.find((x) => x.pinned === sq);
  if (pin) lines.push(`Pinned by ${tag(p, pin.pinner)}${pin.absolute ? " to the king" : ""}.`);
  if (piece.type !== "p" && piece.type !== "k") {
    const safe = safeSquares(ctx, sq);
    if (enPrise(ctx, sq)) lines.push(`At risk. Safe squares: ${safe.length ? safe.join(", ") : "none"}.`);
  }
  return { sq, lines, marks };
}
