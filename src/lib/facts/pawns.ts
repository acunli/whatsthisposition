import { ALL_SQUARES, FILES, attackersOf, fileIndex, rankIndex, toSquare } from "../chess/board";
import { PIECE_NAME, other, type Color, type Placement, type Square } from "../chess/types";
import { sideName, type Ctx } from "./context";
import { emptyMarks, type Fact } from "./types";

export interface PawnInfo {
  sq: Square;
  color: Color;
  passed: boolean;
  isolated: boolean;
  doubled: boolean;
  backward: boolean;
  /** Attacked more often than defended (static count). */
  vulnerable: boolean;
  protectedPassed: boolean;
  /** Piece directly in front of a passed pawn, if any. */
  blockader?: Square;
}

const pawnsOf = (p: Placement, c: Color) => ALL_SQUARES.filter((s) => p[s]?.type === "p" && p[s]?.color === c);

export function classifyPawns(p: Placement): PawnInfo[] {
  const out: PawnInfo[] = [];
  for (const color of ["w", "b"] as Color[]) {
    const mine = pawnsOf(p, color);
    const theirs = pawnsOf(p, other(color));
    const fwd = color === "w" ? 1 : -1;
    const ahead = (a: Square, b: Square) => (rankIndex(b) - rankIndex(a)) * fwd > 0;
    for (const sq of mine) {
      const f = fileIndex(sq);
      const adjacentOwn = mine.filter((s) => Math.abs(fileIndex(s) - f) === 1);
      const passed = !theirs.some((t) => Math.abs(fileIndex(t) - f) <= 1 && ahead(sq, t));
      const isolated = adjacentOwn.length === 0;
      const doubled = mine.some((s) => s !== sq && fileIndex(s) === f);
      const stop = toSquare(f, rankIndex(sq) + fwd);
      // Backward: every neighbour pawn is already further advanced, and the stop square is hit by an enemy pawn.
      const canBeSupported = adjacentOwn.some((s) => !ahead(sq, s));
      const stopHitByPawn =
        !!stop && attackersOf(p, stop, other(color)).some((a) => p[a]?.type === "p");
      const backward = !isolated && !passed && !canBeSupported && stopHitByPawn;
      const atk = attackersOf(p, sq, other(color)).length;
      const def = attackersOf(p, sq, color).length;
      const protectedPassed = passed && attackersOf(p, sq, color).some((d) => p[d]?.type === "p");
      const blockader = passed && stop && p[stop] && p[stop]!.color !== color ? stop : undefined;
      out.push({ sq, color, passed, isolated, doubled, backward, vulnerable: atk > def, protectedPassed, blockader });
    }
  }
  return out;
}

export function pawnIslands(p: Placement, c: Color): number {
  const files = new Set(pawnsOf(p, c).map(fileIndex));
  let islands = 0;
  for (let f = 0; f < 8; f++) if (files.has(f) && !files.has(f - 1)) islands++;
  return islands;
}

export function pawnFacts(ctx: Ctx): Fact[] {
  const { p } = ctx;
  const facts: Fact[] = [];
  const info = classifyPawns(p);
  const fwd = (c: Color) => (c === "w" ? 1 : -1);

  for (const pi of info) {
    const owner = sideName(pi.color);
    if (pi.passed) {
      const path: Square[] = [];
      for (let r = rankIndex(pi.sq) + fwd(pi.color); r >= 0 && r <= 7; r += fwd(pi.color)) path.push(toSquare(fileIndex(pi.sq), r)!);
      const toGo = path.length;
      facts.push({
        id: `passed-${pi.sq}`,
        lens: "pawns",
        kind: "passed",
        side: pi.color,
        tone: "opportunity",
        anchor: pi.sq,
        title: pi.blockader
          ? `${owner}'s ${pi.sq} pawn is passed but blockaded by the ${PIECE_NAME[p[pi.blockader]!.type]} on ${pi.blockader}.`
          : `${owner}'s ${pi.sq} pawn is passed${pi.protectedPassed ? " and protected by a pawn" : ""}: ${toGo} square${toGo > 1 ? "s" : ""} from promoting.`,
        detail: "No enemy pawn can block or capture it on its way. Only pieces can stop it.",
        evidence: "rules",
        marks: {
          ...emptyMarks(),
          squares: [
            { sq: pi.sq, tone: "opportunity", style: "ring" },
            ...path.map((s, i) => ({ sq: s, tone: "opportunity" as const, style: "flood" as const, order: i })),
            ...(pi.blockader ? [{ sq: pi.blockader, tone: "danger" as const, style: "ring" as const }] : []),
          ],
          icons: [{ sq: path[path.length - 1] ?? pi.sq, icon: "crown", tone: "opportunity" }],
        },
        priority: 60 + (7 - toGo) * 3,
      });
    }
    if (pi.isolated) {
      facts.push({
        id: `isolated-${pi.sq}`,
        lens: "pawns",
        kind: "isolated",
        side: pi.color,
        tone: "danger",
        anchor: pi.sq,
        title: `${owner}'s ${pi.sq} pawn is isolated: no friendly pawn on the neighbouring files can defend it.`,
        evidence: "rules",
        marks: { ...emptyMarks(), squares: [{ sq: pi.sq, tone: "danger", style: "ring" }] },
        priority: 35,
      });
    }
    if (pi.backward) {
      const stop = toSquare(fileIndex(pi.sq), rankIndex(pi.sq) + fwd(pi.color))!;
      facts.push({
        id: `backward-${pi.sq}`,
        lens: "pawns",
        kind: "backward",
        side: pi.color,
        tone: "danger",
        anchor: pi.sq,
        title: `${owner}'s ${pi.sq} pawn is backward: its neighbours have moved past it and an enemy pawn guards ${stop}.`,
        detail: `${stop} is a potential outpost for ${sideName(other(pi.color))}.`,
        evidence: "rules",
        marks: {
          ...emptyMarks(),
          squares: [
            { sq: pi.sq, tone: "danger", style: "ring" },
            { sq: stop, tone: "opportunity", style: "dashed" },
          ],
        },
        priority: 33,
      });
    }
    if (pi.vulnerable) {
      const atk = attackersOf(p, pi.sq, other(pi.color));
      const def = attackersOf(p, pi.sq, pi.color);
      facts.push({
        id: `vulnerable-${pi.sq}`,
        lens: "pawns",
        kind: "vulnerable",
        side: pi.color,
        tone: "danger",
        anchor: pi.sq,
        title: `${owner}'s ${pi.sq} pawn is attacked ${atk.length}× and defended ${def.length}×.`,
        evidence: "rules",
        marks: {
          ...emptyMarks(),
          squares: [{ sq: pi.sq, tone: "danger", style: "pulse" }],
          arrows: atk.map((a) => ({ from: a, to: pi.sq, tone: "danger" as const, thin: true })),
        },
        priority: 45,
      });
    }
  }

  // Doubled pawns: one fact per file
  const doubledFiles = new Map<string, Square[]>();
  for (const pi of info.filter((x) => x.doubled)) {
    const key = pi.color + fileIndex(pi.sq);
    doubledFiles.set(key, [...(doubledFiles.get(key) ?? []), pi.sq]);
  }
  for (const [key, squares] of doubledFiles) {
    const color = key[0] as Color;
    facts.push({
      id: `doubled-${key}`,
      lens: "pawns",
      kind: "doubled",
      side: color,
      tone: "danger",
      anchor: squares[0],
      title: `${sideName(color)} has doubled pawns on the ${FILES[fileIndex(squares[0])]}-file (${squares.join(", ")}).`,
      detail: "The front pawn blocks the back one, and neither can defend the other.",
      evidence: "rules",
      marks: { ...emptyMarks(), squares: squares.map((s) => ({ sq: s, tone: "danger" as const, style: "dashed" as const })) },
      priority: 30,
    });
  }
  return facts;
}

export function pawnSummary(p: Placement): string {
  return `Pawn islands: White ${pawnIslands(p, "w")} · Black ${pawnIslands(p, "b")}`;
}
