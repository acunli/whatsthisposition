import { ALL_SQUARES, FILES, attackersOf, between, fileIndex, isLightSquare, rankIndex, toSquare } from "../chess/board";
import { PIECE_NAME, other, type Color, type Placement, type Square } from "../chess/types";
import { describe, sideName, type Ctx } from "./context";
import { emptyMarks, type Fact } from "./types";

/** Destinations not occupied by own pieces and not attacked by enemy pawns. */
export function safeMobility(p: Placement, sq: Square, attacks: Square[]): Square[] {
  const piece = p[sq];
  if (!piece) return [];
  return attacks.filter((t) => {
    if (p[t]?.color === piece.color) return false;
    return !attackersOf(p, t, other(piece.color)).some((a) => p[a]?.type === "p");
  });
}

/**
 * An outpost for `color`: in the opponent's half (ranks 4–6 from its side),
 * defended by an own pawn, and no enemy pawn can ever attack it.
 */
export function isOutpost(p: Placement, sq: Square, color: Color): boolean {
  const r = rankIndex(sq);
  const rel = color === "w" ? r : 7 - r;
  if (rel < 3 || rel > 5) return false;
  const f = fileIndex(sq);
  if (f === 0 || f === 7) return false;
  const pawnDefended = attackersOf(p, sq, color).some((a) => p[a]?.type === "p" && p[a]?.color === color);
  if (!pawnDefended) return false;
  const enemy = other(color);
  for (const s of ALL_SQUARES) {
    const x = p[s];
    if (!x || x.type !== "p" || x.color !== enemy) continue;
    if (Math.abs(fileIndex(s) - f) !== 1) continue;
    // Enemy pawns attack towards the enemy's forward direction; a pawn still "behind" sq (from the enemy's view) could come.
    const aheadOfSquare = color === "w" ? rankIndex(s) > r : rankIndex(s) < r;
    if (aheadOfSquare) return false;
  }
  return true;
}

export function fileState(p: Placement, f: number): { w: boolean; b: boolean } {
  const out = { w: false, b: false };
  for (let r = 0; r < 8; r++) {
    const x = p[toSquare(f, r)!];
    if (x?.type === "p") out[x.color] = true;
  }
  return out;
}

export function activityFacts(ctx: Ctx): Fact[] {
  const { p } = ctx;
  const facts: Fact[] = [];
  const fullmove = Number(ctx.fen.split(" ")[5]) || 1;

  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (!piece || !["n", "b", "r", "q"].includes(piece.type)) continue;
    const owner = sideName(piece.color);
    const mob = safeMobility(p, sq, ctx.attacks(sq));
    const limit = piece.type === "q" ? 3 : 2;
    const onHome =
      (piece.color === "w" ? rankIndex(sq) === 0 : rankIndex(sq) === 7) &&
      ((piece.type === "n" && ["b", "g"].includes(sq[0])) || (piece.type === "b" && ["c", "f"].includes(sq[0])));

    if (onHome && fullmove <= 20 && piece.type !== "r") {
      facts.push({
        id: `undeveloped-${sq}`,
        lens: "activity",
        kind: "undeveloped",
        side: piece.color,
        tone: "info",
        anchor: sq,
        title: `${owner}'s ${PIECE_NAME[piece.type]} on ${sq} hasn't moved yet.`,
        evidence: "rules",
        marks: { ...emptyMarks(), squares: [{ sq, tone: "info", style: "dashed" }] },
        priority: 20,
      });
    } else if (mob.length <= limit && !((piece.type === "r" || piece.type === "q") && rankIndex(sq) === (piece.color === "w" ? 0 : 7))) {
      const ownBlockers = ctx.attacks(sq).filter((t) => p[t]?.color === piece.color && p[t]?.type === "p");
      facts.push({
        id: `restricted-${sq}`,
        lens: "activity",
        kind: "restricted",
        side: piece.color,
        tone: "danger",
        anchor: sq,
        title:
          mob.length === 0
            ? `${describe(p, sq)} has no safe square to move to.`
            : `${describe(p, sq)} is cramped: only ${mob.length} safe square${mob.length > 1 ? "s" : ""} (${mob.join(", ")}).`,
        detail: ownBlockers.length
          ? `Its own pawn${ownBlockers.length > 1 ? "s" : ""} on ${ownBlockers.join(", ")} block${ownBlockers.length > 1 ? "" : "s"} it.`
          : "Squares attacked by enemy pawns don't count as safe.",
        evidence: "rules",
        marks: {
          ...emptyMarks(),
          squares: [
            { sq, tone: "danger", style: "ring" },
            ...mob.map((s) => ({ sq: s, tone: "info" as const, style: "dot" as const })),
            ...ownBlockers.map((s) => ({ sq: s, tone: "info" as const, style: "dashed" as const })),
          ],
        },
        priority: 45,
      });
    }

    // Bad bishop: blocked by several own pawns fixed on its colour
    if (piece.type === "b") {
      const own = ALL_SQUARES.filter((s) => p[s]?.type === "p" && p[s]?.color === piece.color && isLightSquare(s) === isLightSquare(sq));
      const blocked = own.filter((s) => {
        const front = toSquare(fileIndex(s), rankIndex(s) + (piece.color === "w" ? 1 : -1));
        return !!front && !!p[front];
      });
      if (blocked.length >= 3) {
        facts.push({
          id: `badbishop-${sq}`,
          lens: "activity",
          kind: "bad-bishop",
          side: piece.color,
          tone: "danger",
          anchor: sq,
          title: `${owner}'s bishop on ${sq} shares its colour with ${blocked.length} blocked ${owner} pawns (${blocked.join(", ")}).`,
          detail: "Those pawns can't move out of its way, so its diagonals stay short.",
          evidence: "rules",
          marks: {
            ...emptyMarks(),
            squares: [{ sq, tone: "danger", style: "ring" }, ...blocked.map((s) => ({ sq: s, tone: "info" as const, style: "dashed" as const }))],
          },
          priority: 40,
        });
      }
    }
  }

  // Outposts: occupied ones, and empty ones a knight can reach next move
  for (const color of ["w", "b"] as Color[]) {
    for (const sq of ALL_SQUARES) {
      if (!isOutpost(p, sq, color)) continue;
      const here = p[sq];
      if (here?.color === color && (here.type === "n" || here.type === "b")) {
        facts.push({
          id: `outpost-occupied-${sq}`,
          lens: "activity",
          kind: "outpost",
          side: color,
          tone: "opportunity",
          anchor: sq,
          title: `${describe(p, sq)} sits on an outpost: pawn-supported, and no ${sideName(other(color))} pawn can chase it.`,
          evidence: "rules",
          marks: { ...emptyMarks(), squares: [{ sq, tone: "opportunity", style: "flood" }], icons: [{ sq, icon: "flag", tone: "opportunity" }] },
          priority: 50,
        });
        continue;
      }
      if (here) continue;
      const knights = ALL_SQUARES.filter(
        (s) => p[s]?.type === "n" && p[s]?.color === color && ctx.attacks(s).includes(sq),
      );
      if (!knights.length) continue;
      facts.push({
        id: `outpost-${color}-${sq}`,
        lens: "activity",
        kind: "outpost-available",
        side: color,
        tone: "idea",
        anchor: sq,
        title: `${sq} is an outpost for ${sideName(color)}; ${describe(p, knights[0], { owner: false })} can jump there.`,
        detail: "An outpost is a square in the opponent's half, supported by a pawn, that no enemy pawn can ever attack.",
        evidence: "idea",
        marks: {
          ...emptyMarks(),
          squares: [{ sq, tone: "opportunity", style: "dashed" }],
          arrows: knights.map((k) => ({ from: k, to: sq, tone: "idea" as const, dashed: true })),
        },
        priority: 42,
      });
    }
  }

  // Open files and heavy pieces on them
  for (let f = 0; f < 8; f++) {
    const st = fileState(p, f);
    const fileSquares = Array.from({ length: 8 }, (_, r) => toSquare(f, r)!);
    const heavy = fileSquares.filter((s) => p[s]?.type === "r" || p[s]?.type === "q");
    if (!st.w && !st.b) {
      const users = heavy.map((s) => describe(p, s));
      facts.push({
        id: `open-${f}`,
        lens: "activity",
        kind: "open-file",
        side: heavy.length ? p[heavy[0]]!.color : ctx.turn,
        tone: heavy.length ? "opportunity" : "info",
        anchor: heavy[0] ?? fileSquares[3],
        title: heavy.length
          ? `The ${FILES[f]}-file is open and ${users.join(" and ")} ${heavy.length > 1 ? "use" : "uses"} it.`
          : `The ${FILES[f]}-file is open (no pawns) and no rook or queen is on it yet.`,
        evidence: "rules",
        marks: {
          ...emptyMarks(),
          bands: [{ kind: "file", index: f, tone: heavy.length ? "opportunity" : "info" }],
          squares: heavy.map((s) => ({ sq: s, tone: "opportunity" as const, style: "ring" as const })),
        },
        priority: heavy.length ? 38 : 22,
      });
    } else {
      for (const color of ["w", "b"] as Color[]) {
        if (st[color] || !st[other(color)]) continue;
        const mine = heavy.filter((s) => p[s]?.color === color);
        if (!mine.length) continue;
        facts.push({
          id: `halfopen-${color}-${f}`,
          lens: "activity",
          kind: "half-open-file",
          side: color,
          tone: "opportunity",
          anchor: mine[0],
          title: `${describe(p, mine[0])} presses down the half-open ${FILES[f]}-file.`,
          detail: `${sideName(color)} has no pawn on this file, so the ${sideName(other(color))} pawn on it is a natural target.`,
          evidence: "rules",
          marks: {
            ...emptyMarks(),
            squares: fileSquares.filter((s) => p[s]?.type === "p").map((s) => ({ sq: s, tone: "danger" as const, style: "ring" as const })),
          },
          priority: 34,
        });
      }
    }
  }

  // Bishop pair and connected rooks
  for (const color of ["w", "b"] as Color[]) {
    const bishops = ALL_SQUARES.filter((s) => p[s]?.type === "b" && p[s]?.color === color);
    const other_ = ALL_SQUARES.filter((s) => p[s]?.type === "b" && p[s]?.color === other(color));
    if (bishops.length >= 2 && new Set(bishops.map(isLightSquare)).size === 2 && other_.length < 2) {
      facts.push({
        id: `bishoppair-${color}`,
        lens: "activity",
        kind: "bishop-pair",
        side: color,
        tone: "opportunity",
        anchor: bishops[0],
        title: `${sideName(color)} has the bishop pair; together they cover both square colours.`,
        evidence: "rules",
        marks: { ...emptyMarks(), squares: bishops.map((s) => ({ sq: s, tone: "opportunity" as const, style: "ring" as const })) },
        priority: 28,
      });
    }
    const rooks = ALL_SQUARES.filter((s) => p[s]?.type === "r" && p[s]?.color === color);
    if (rooks.length === 2) {
      const [a, b] = rooks;
      const aligned = a[0] === b[0] || a[1] === b[1];
      if (aligned && between(a, b).every((s) => !p[s])) {
        facts.push({
          id: `rooks-${color}`,
          lens: "activity",
          kind: "connected-rooks",
          side: color,
          tone: "opportunity",
          anchor: a,
          title: `${sideName(color)}'s rooks on ${a} and ${b} are connected and protect each other.`,
          evidence: "rules",
          marks: { ...emptyMarks(), links: [{ from: a, to: b, tone: "opportunity", kind: "link" }], squares: [a, b].map((s) => ({ sq: s, tone: "opportunity" as const, style: "ring" as const })) },
          priority: 24,
        });
      }
    }
  }
  return facts;
}
