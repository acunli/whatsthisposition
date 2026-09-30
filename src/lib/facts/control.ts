import { ALL_SQUARES, BISHOP_DIRS, ROOK_DIRS, controlMap, fileIndex, rankIndex, toSquare } from "../chess/board";
import { COLOR_NAME, other, type Color, type Placement, type Square } from "../chess/types";
import { describe, listSquares, sideName, type Ctx } from "./context";
import { emptyMarks, type Fact, type Marks } from "./types";

export const CENTER: Square[] = ["d4", "d5", "e4", "e5"];

/** Background tint for every square, by who attacks it more. */
export function controlMarks(p: Placement): Marks {
  const map = controlMap(p);
  const marks = emptyMarks();
  for (const sq of ALL_SQUARES) {
    const { w, b } = map[sq];
    if (!w && !b) continue;
    const order = 7 - rankIndex(sq) + fileIndex(sq);
    if (w > b) marks.squares.push({ sq, tone: "white", style: "flood", order });
    else if (b > w) marks.squares.push({ sq, tone: "black", style: "flood", order });
    else marks.squares.push({ sq, tone: "info", style: "hatch", order });
  }
  return marks;
}

interface Battery {
  color: Color;
  squares: Square[];
}

function findBatteries(p: Placement): Battery[] {
  const out: Battery[] = [];
  const seen = new Set<string>();
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (!piece || !["q", "r", "b"].includes(piece.type)) continue;
    const dirs: [number[], boolean][] = [
      ...ROOK_DIRS.map((d) => [d, true] as [number[], boolean]),
      ...BISHOP_DIRS.map((d) => [d, false] as [number[], boolean]),
    ];
    for (const [[df, dr], straight] of dirs) {
      if (dr === 0) continue; // side-by-side on a rank is just "connected", not a battery
      const fits = (t: string) => t === "q" || (straight ? t === "r" : t === "b");
      if (!fits(piece.type)) continue;
      let f = fileIndex(sq) + df;
      let r = rankIndex(sq) + dr;
      let s = toSquare(f, r);
      while (s && !p[s]) {
        f += df;
        r += dr;
        s = toSquare(f, r);
      }
      if (!s) continue;
      const next = p[s]!;
      if (next.color !== piece.color || !fits(next.type)) continue;
      if (piece.type === next.type && piece.type !== "r") continue; // two bishops can't share a diagonal meaningfully
      const key = [sq, s].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ color: piece.color, squares: [sq, s] });
    }
  }
  return out;
}

export function controlFacts(ctx: Ctx): Fact[] {
  const { p } = ctx;
  const facts: Fact[] = [];
  const map = controlMap(p);

  const center = { w: 0, b: 0, contested: 0 };
  for (const sq of CENTER) {
    const { w, b } = map[sq];
    if (w > b) center.w++;
    else if (b > w) center.b++;
    else if (w) center.contested++;
  }
  facts.push({
    id: "center",
    lens: "control",
    kind: "center",
    side: center.w >= center.b ? "w" : "b",
    tone: "info",
    anchor: "e4",
    title: `Centre squares: White controls ${center.w}, Black ${center.b}${center.contested ? `, ${center.contested} evenly contested` : ""}.`,
    detail: "Counted by how many pieces attack each of d4, d5, e4 and e5.",
    evidence: "rules",
    marks: {
      ...emptyMarks(),
      squares: CENTER.map((sq) => ({ sq, tone: "info" as const, style: "ring" as const })),
      badges: CENTER.map((sq) => ({ sq, text: `${map[sq].w}·${map[sq].b}`, tone: "info" as const })),
    },
    priority: 30,
  });

  // Targets: pieces hit by two or more enemy pieces
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (!piece || piece.type === "k") continue;
    const enemy = other(piece.color);
    const atk = ctx.attackers(sq, enemy);
    if (atk.length < 2) continue;
    const def = ctx.attackers(sq, piece.color);
    facts.push({
      id: `target-${sq}`,
      lens: "control",
      kind: "target",
      side: piece.color,
      tone: atk.length > def.length ? "danger" : "info",
      anchor: sq,
      title: `${describe(p, sq)} is hit by ${atk.length} ${sideName(enemy)} pieces and defended by ${def.length}.`,
      detail: `Attackers: ${listSquares(p, atk, 5)}${def.length ? `. Defenders: ${listSquares(p, def, 5)}` : ""}.`,
      evidence: "rules",
      marks: {
        ...emptyMarks(),
        squares: [{ sq, tone: atk.length > def.length ? "danger" : "info", style: "ring" }],
        arrows: [
          ...atk.map((a) => ({ from: a, to: sq, tone: "danger" as const, thin: true })),
          ...def.map((d) => ({ from: d, to: sq, tone: "info" as const, thin: true, dashed: true })),
        ],
        badges: [{ sq, text: `${atk.length}v${def.length}`, tone: atk.length > def.length ? "danger" : "info" }],
      },
      priority: 50 + (atk.length - def.length) * 5,
    });
  }

  // Loose pieces: not defended at all (even if not attacked yet)
  for (const color of ["w", "b"] as Color[]) {
    const loose = ALL_SQUARES.filter((sq) => {
      const x = p[sq];
      return x && x.color === color && x.type !== "k" && x.type !== "p" && ctx.attackers(sq, color).length === 0;
    });
    if (!loose.length) continue;
    facts.push({
      id: `loose-${color}`,
      lens: "control",
      kind: "loose",
      side: color,
      tone: "danger",
      anchor: loose[0],
      title: `${COLOR_NAME[color]}'s undefended pieces: ${listSquares(p, loose, 4)}.`,
      detail: "Undefended pieces are the usual targets of forks and double attacks.",
      evidence: "rules",
      marks: { ...emptyMarks(), squares: loose.map((s) => ({ sq: s, tone: "danger" as const, style: "dashed" as const })) },
      priority: 35,
    });
  }

  for (const b of findBatteries(p)) {
    facts.push({
      id: `battery-${b.squares.join("")}`,
      lens: "control",
      kind: "battery",
      side: b.color,
      tone: "opportunity",
      anchor: b.squares[0],
      title: `${describe(p, b.squares[0])} and ${describe(p, b.squares[1], { owner: false })} line up on the same line.`,
      detail: "Pieces lined up like this add their force together along that line.",
      evidence: "rules",
      marks: {
        ...emptyMarks(),
        squares: b.squares.map((s) => ({ sq: s, tone: "opportunity" as const, style: "ring" as const })),
        links: [{ from: b.squares[1], to: b.squares[0], tone: "opportunity", kind: "link" }],
      },
      priority: 32,
    });
  }
  return facts;
}
