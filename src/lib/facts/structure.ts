/**
 * Deeper pawn-structure facts: holes, weak colour complexes, pawn chains and their
 * bases, wing majorities and hanging pawns. All follow from the pawn placement alone.
 */
import { ALL_SQUARES, FILES, attackersOf, fileIndex, isLightSquare, rankIndex, toSquare } from "../chess/board";
import { other, type Color, type Placement, type Square } from "../chess/types";
import { sideName, type Ctx } from "./context";
import { emptyMarks, type Fact, type LinkMark } from "./types";

const pawns = (p: Placement, c: Color) => ALL_SQUARES.filter((s) => p[s]?.type === "p" && p[s]?.color === c);
const rel = (sq: Square, c: Color) => (c === "w" ? rankIndex(sq) : 7 - rankIndex(sq));

/**
 * Can a `c` pawn ever attack `sq`? True if some own pawn on an adjacent file stands
 * behind the square's attack rank (pawns only move forward).
 */
export function pawnCanEverCover(p: Placement, sq: Square, c: Color): boolean {
  const f = fileIndex(sq);
  const r = rel(sq, c);
  return pawns(p, c).some((s) => Math.abs(fileIndex(s) - f) === 1 && rel(s, c) < r);
}

/**
 * Holes for side `c`: squares on its 3rd–4th ranks (the ones in front of its camp),
 * files b–g, that no `c` pawn can ever defend again. Only counted while `c` still has
 * pawns nearby, so a bare wing isn't reported square by square.
 */
export function holes(p: Placement, c: Color): Square[] {
  const mine = pawns(p, c);
  return ALL_SQUARES.filter((sq) => {
    const r = rel(sq, c);
    const f = fileIndex(sq);
    if (r < 2 || r > 3 || f === 0 || f === 7) return false;
    if (p[sq]?.type === "p" && p[sq]?.color === c) return false;
    const nearby = mine.some((s) => Math.abs(fileIndex(s) - f) <= 1);
    if (!nearby) return false;
    return !pawnCanEverCover(p, sq, c);
  });
}

/** Diagonal pawn-to-pawn protections: [defender, defended]. */
export function pawnLinks(p: Placement, c: Color): [Square, Square][] {
  const fwd = c === "w" ? 1 : -1;
  const out: [Square, Square][] = [];
  for (const s of pawns(p, c)) {
    for (const df of [-1, 1]) {
      const t = toSquare(fileIndex(s) + df, rankIndex(s) + fwd);
      if (t && p[t]?.type === "p" && p[t]?.color === c) out.push([s, t]);
    }
  }
  return out;
}

export interface Chain {
  color: Color;
  squares: Square[];
  base: Square;
  head: Square;
}

/** Pawn chains of 3+ pawns linked diagonally, with base (rearmost) and head (front). */
export function pawnChains(p: Placement, c: Color): Chain[] {
  const links = pawnLinks(p, c);
  const adj = new Map<Square, Square[]>();
  for (const [a, b] of links) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const seen = new Set<Square>();
  const chains: Chain[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const group: Square[] = [];
    const stack = [start];
    while (stack.length) {
      const s = stack.pop()!;
      if (seen.has(s)) continue;
      seen.add(s);
      group.push(s);
      stack.push(...(adj.get(s) ?? []));
    }
    if (group.length < 3) continue;
    const sorted = [...group].sort((a, b) => rel(a, c) - rel(b, c));
    chains.push({ color: c, squares: group, base: sorted[0], head: sorted[sorted.length - 1] });
  }
  return chains;
}

const WINGS: [string, number[]][] = [
  ["queenside", [0, 1, 2]],
  ["kingside", [5, 6, 7]],
];

export function structureFacts(ctx: Ctx): Fact[] {
  const { p } = ctx;
  const facts: Fact[] = [];

  for (const c of ["w", "b"] as Color[]) {
    const enemy = other(c);
    const myPawns = pawns(p, c).length;
    const enemyPieces = ALL_SQUARES.filter((s) => p[s]?.color === enemy && ["n", "b", "r", "q"].includes(p[s]!.type));
    // Holes only matter with a real pawn structure and enemy pieces that could use them.
    const hs = myPawns >= 4 && enemyPieces.length ? holes(p, c) : [];
    const k = ALL_SQUARES.find((s) => p[s]?.type === "k" && p[s]?.color === c);
    const important = hs.filter((sq) => {
      const central = fileIndex(sq) >= 2 && fileIndex(sq) <= 5;
      const nearKing = k ? Math.abs(fileIndex(sq) - fileIndex(k)) <= 1 && Math.abs(rankIndex(sq) - rankIndex(k)) <= 2 : false;
      const usable = p[sq]?.color === enemy || attackersOf(p, sq, enemy).length > 0;
      return (central || nearKing) && usable;
    });
    for (const sq of important.slice(0, 4)) {
      const occupiedByEnemy = p[sq]?.color === enemy;
      facts.push({
        id: `hole-${c}-${sq}`,
        lens: "pawns",
        kind: "hole",
        side: c,
        tone: "danger",
        anchor: sq,
        title: occupiedByEnemy
          ? `${sq} is a hole in ${sideName(c)}'s camp, and ${sideName(enemy)} already sits on it.`
          : `${sq} is a hole in ${sideName(c)}'s camp: no ${sideName(c)} pawn can ever cover it again.`,
        detail: `A piece that lands on ${sq} can only be chased by ${sideName(c)}'s pieces, never by a pawn. It's a natural home for a ${sideName(enemy)} knight.`,
        evidence: "rules",
        label: `Hole on ${sq}`,
        polarity: "weakness",
        marks: { ...emptyMarks(), squares: [{ sq, tone: "danger", style: "pit" }] },
        priority: occupiedByEnemy ? 58 : 44,
      });
    }

    // Weak colour complex: several holes on one colour and that bishop is gone.
    for (const light of [true, false]) {
      const onColour = hs.filter((sq) => isLightSquare(sq) === light);
      const bishop = ALL_SQUARES.some((s) => p[s]?.type === "b" && p[s]?.color === c && isLightSquare(s) === light);
      const enemyCanUse = enemyPieces.some((s) => p[s]!.type === "q" || p[s]!.type === "n" || (p[s]!.type === "b" && isLightSquare(s) === light));
      if (onColour.length >= 3 && !bishop && myPawns >= 5 && enemyCanUse) {
        facts.push({
          id: `complex-${c}-${light ? "l" : "d"}`,
          lens: "pawns",
          kind: "colour-complex",
          side: c,
          tone: "danger",
          anchor: onColour[0],
          title: `${sideName(c)} is weak on the ${light ? "light" : "dark"} squares: ${onColour.length} holes and no ${light ? "light" : "dark"}-squared bishop to guard them.`,
          evidence: "rules",
          label: `Weak ${light ? "light" : "dark"} squares`,
          polarity: "weakness",
          marks: { ...emptyMarks(), squares: onColour.map((sq, i) => ({ sq, tone: "danger" as const, style: "flood" as const, order: i })) },
          priority: 55,
        });
      }
    }

    // Pawn chains and their base
    for (const ch of pawnChains(p, c)) {
      const links: LinkMark[] = pawnLinks(p, c)
        .filter(([a, b]) => ch.squares.includes(a) && ch.squares.includes(b))
        .map(([a, b]) => ({ from: a, to: b, tone: "info", kind: "chain" }));
      facts.push({
        id: `chain-${c}-${ch.base}`,
        lens: "pawns",
        kind: "pawn-chain",
        side: c,
        tone: "info",
        anchor: ch.head,
        title: `${sideName(c)}'s pawn chain ${ch.base}–${ch.head}: its base on ${ch.base} is the point to attack.`,
        detail: `Each pawn in the chain is protected by the one behind it, except the base. Nimzowitsch's rule: strike at the base of the chain.`,
        evidence: "rules",
        label: `Chain ${ch.base}–${ch.head}`,
        polarity: "neutral",
        marks: {
          ...emptyMarks(),
          links,
          icons: [{ sq: ch.base, icon: "target", tone: "danger" }],
          squares: [{ sq: ch.base, tone: "danger", style: "ring" }],
        },
        priority: 36,
      });
    }

    // Hanging pawns: two side-by-side pawns on half-open files with no neighbours.
    const mine = pawns(p, c);
    for (const a of mine) {
      const b = toSquare(fileIndex(a) + 1, rankIndex(a));
      if (!b || p[b]?.type !== "p" || p[b]?.color !== c) continue;
      const fa = fileIndex(a);
      const neighbours = mine.some((s) => fileIndex(s) === fa - 1 || fileIndex(s) === fa + 2);
      const halfOpen = [fa, fa + 1].every((f) => !pawns(p, enemy).some((s) => fileIndex(s) === f));
      if (neighbours || !halfOpen || rel(a, c) < 3) continue;
      facts.push({
        id: `hanging-pawns-${a}`,
        lens: "pawns",
        kind: "hanging-pawns",
        side: c,
        tone: "info",
        anchor: a,
        title: `${sideName(c)}'s pawns on ${a} and ${b} are "hanging pawns": strong in the centre, but a target on the open files.`,
        evidence: "rules",
        label: `Hanging pawns ${a}/${b}`,
        polarity: "neutral",
        marks: { ...emptyMarks(), squares: [a, b].map((sq) => ({ sq, tone: "info" as const, style: "ring" as const })), links: [{ from: a, to: b, tone: "info", kind: "link" }] },
        priority: 40,
      });
    }

    // Wing majorities
    for (const [wing, files] of WINGS) {
      const m = mine.filter((s) => files.includes(fileIndex(s))).length;
      const t = pawns(p, enemy).filter((s) => files.includes(fileIndex(s))).length;
      if (m > t && m >= 2) {
        const squares = mine.filter((s) => files.includes(fileIndex(s)));
        facts.push({
          id: `majority-${c}-${wing}`,
          lens: "pawns",
          kind: "majority",
          side: c,
          tone: "opportunity",
          anchor: squares[0],
          title: `${sideName(c)} has a ${wing} majority (${m} v ${t}): advancing it can create a passed pawn.`,
          evidence: "rules",
          label: `${wing[0].toUpperCase()}${wing.slice(1)} majority ${m}v${t}`,
          polarity: "strength",
          marks: { ...emptyMarks(), squares: squares.map((sq, i) => ({ sq, tone: "opportunity" as const, style: "ring" as const, order: i })) },
          priority: 34,
        });
      }
    }
  }
  return facts;
}

export function fileName(f: number) {
  return FILES[f];
}
