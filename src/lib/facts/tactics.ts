/**
 * Extra tactical patterns: skewers, discovered-attack setups, back-rank weakness and a
 * king danger meter built from Stockfish-style attack units.
 */
import { ALL_SQUARES, BISHOP_DIRS, ROOK_DIRS, attackersOf, fileIndex, rankIndex, toSquare } from "../chess/board";
import { PIECE_NAME, other, type Color, type Square } from "../chess/types";
import { describe, kingOf, sideName, the, value, type Ctx } from "./context";
import { escapeSquares, kingZone } from "./king";
import { emptyMarks, type Fact } from "./types";

function rays(sq: Square) {
  return [
    ...ROOK_DIRS.map((d) => [d, true] as [number[], boolean]),
    ...BISHOP_DIRS.map((d) => [d, false] as [number[], boolean]),
  ].map(([[df, dr], straight]) => {
    const out: Square[] = [];
    let f = fileIndex(sq) + df;
    let r = rankIndex(sq) + dr;
    let s = toSquare(f, r);
    while (s) {
      out.push(s);
      f += df;
      r += dr;
      s = toSquare(f, r);
    }
    return { line: out, straight };
  });
}

export function tacticFacts(ctx: Ctx): Fact[] {
  const { p } = ctx;
  const facts: Fact[] = [];

  // Skewers and discovered-attack setups, from every slider.
  for (const sq of ALL_SQUARES) {
    const slider = p[sq];
    if (!slider || !["b", "r", "q"].includes(slider.type)) continue;
    for (const { line, straight } of rays(sq)) {
      if (!(slider.type === "q" || (straight ? slider.type === "r" : slider.type === "b"))) continue;
      const hits = line.filter((s) => p[s]).slice(0, 2);
      if (hits.length < 2) continue;
      const [front, back] = hits;
      const fp = p[front]!;
      const bp = p[back]!;
      // Skewer: enemy front piece more valuable than the enemy piece behind it.
      const skewer =
        fp.color !== slider.color &&
        bp.color !== slider.color &&
        bp.type !== "p" &&
        value(fp) > value(bp) &&
        (fp.type === "k" || value(fp) > value(slider));
      if (skewer) {
        facts.push({
          id: `skewer-${sq}-${front}`,
          lens: "threats",
          kind: "skewer",
          side: slider.color,
          tone: "opportunity",
          anchor: front,
          title: `Skewer: ${the(p, sq)} hits ${the(p, front)}, and ${the(p, back)} stands behind it.`,
          detail: `If the ${PIECE_NAME[fp.type]} steps aside, the ${PIECE_NAME[bp.type]} behind it can be taken.`,
          evidence: "rules",
          label: `Skewer on ${front}`,
          polarity: "strength",
          marks: {
            ...emptyMarks(),
            links: [{ from: sq, to: back, tone: "opportunity", kind: "xray" }],
            squares: [
              { sq: front, tone: "danger", style: "pulse" },
              { sq: back, tone: "danger", style: "ring" },
            ],
          },
          priority: 72,
        });
      }
      // Discovered attack setup: own piece in front, enemy king or queen behind.
      const pawnStaysOnLine = fp.type === "p" && straight && fileIndex(front) === fileIndex(sq);
      if (fp.color === slider.color && fp.type !== "k" && !pawnStaysOnLine && bp.color !== slider.color && (bp.type === "k" || bp.type === "q")) {
        facts.push({
          id: `discovery-${sq}-${front}`,
          lens: "threats",
          kind: "discovery",
          side: slider.color,
          tone: "opportunity",
          anchor: front,
          title: `${describe(p, front)} blocks ${the(p, sq)}'s line to ${the(p, back)}: moving it uncovers ${bp.type === "k" ? "check" : "an attack on the queen"}.`,
          detail: "A discovered attack lets the moving piece make a second threat of its own.",
          evidence: "rules",
          label: `Discovery on ${front}`,
          polarity: "strength",
          marks: {
            ...emptyMarks(),
            links: [{ from: sq, to: back, tone: "opportunity", kind: "xray" }],
            squares: [
              { sq: front, tone: "opportunity", style: "ring" },
              { sq: back, tone: "danger", style: "pulse" },
            ],
            icons: [{ sq: front, icon: "bolt", tone: "opportunity" }],
          },
          priority: 66,
        });
      }
    }
  }

  // Back-rank weakness and king danger meter
  for (const c of ["w", "b"] as Color[]) {
    const k = kingOf(ctx, c);
    if (!k) continue;
    const enemy = other(c);
    const home = c === "w" ? 0 : 7;
    if (rankIndex(k) === home) {
      const free = escapeSquares(p, c).filter((s) => rankIndex(s) !== home);
      const heavy = ALL_SQUARES.filter((s) => p[s]?.color === enemy && (p[s]?.type === "r" || p[s]?.type === "q"));
      // Heavy pieces that can reach our back rank: already on it or on a file with none of our pawns.
      const reaching = heavy.filter((s) => {
        if (rankIndex(s) === home) return true;
        const f = fileIndex(s);
        return !ALL_SQUARES.some((x) => fileIndex(x) === f && p[x]?.type === "p" && p[x]?.color === c);
      });
      const defenders = ALL_SQUARES.filter((s) => rankIndex(s) === home && p[s]?.color === c && (p[s]?.type === "r" || p[s]?.type === "q"));
      if (free.length === 0 && reaching.length && reaching.length >= defenders.length) {
        facts.push({
          id: `backrank-${c}`,
          lens: "king",
          kind: "back-rank",
          side: c,
          tone: "danger",
          anchor: k,
          title: `${sideName(c)}'s king can't leave the back rank: a rook or queen check there could be mate.`,
          detail: "Making a flight square (luft) with a pawn move is the usual cure.",
          evidence: "rules",
          label: "Back-rank weakness",
          polarity: "weakness",
          marks: { ...emptyMarks(), bands: [{ kind: "rank", index: home, tone: "danger" }], squares: [{ sq: k, tone: "danger", style: "pulse" }] },
          priority: 76,
        });
      }
    }

    // Attack units on the king zone: minor 2, rook 3, queen 5 (Stockfish's scheme).
    // With no enemy pieces left there is no attack to speak of.
    const enemyPieces = ALL_SQUARES.filter((s) => p[s]?.color === enemy && ["n", "b", "r", "q"].includes(p[s]!.type));
    if (!enemyPieces.length) continue;
    const enemyQueen = enemyPieces.some((s) => p[s]!.type === "q");
    const onHome = Math.abs(rankIndex(k) - home) <= 1;
    const zone = [k, ...kingZone(k)];
    const attackers = new Set<Square>();
    for (const z of zone) for (const a of attackersOf(p, z, enemy)) if (p[a]!.type !== "k" && p[a]!.type !== "p") attackers.add(a);
    const units = [...attackers].reduce((s, a) => s + ({ n: 2, b: 2, r: 3, q: 5 } as Record<string, number>)[p[a]!.type], 0);
    const shieldFiles = [fileIndex(k) - 1, fileIndex(k), fileIndex(k) + 1].filter((f) => f >= 0 && f <= 7);
    const fwd = c === "w" ? 1 : -1;
    const shield = shieldFiles.filter((f) => [1, 2].some((d) => {
      const s = toSquare(f, rankIndex(k) + d * fwd);
      return !!s && p[s]?.type === "p" && p[s]?.color === c;
    }));
    const structural = (onHome ? (shieldFiles.length - shield.length) * 2 : 3) + (escapeSquares(p, c).length === 0 ? 2 : 0);
    const danger = Math.round(units + structural * (enemyQueen ? 1 : enemyPieces.length >= 2 ? 0.5 : 0.25));
    const level = danger >= 12 ? "high" : danger >= 6 ? "medium" : "low";
    const heat = zone.map((z) => ({ z, n: attackersOf(p, z, enemy).length })).filter((x) => x.n > 0);
    facts.push({
      id: `danger-${c}`,
      lens: "king",
      kind: "king-danger",
      side: c,
      tone: level === "low" ? "info" : "danger",
      anchor: k,
      title:
        level === "low"
          ? `${sideName(c)}'s king is safe for now: few enemy pieces reach it.`
          : `${sideName(c)}'s king is in ${level} danger: ${attackers.size} ${sideName(enemy)} piece${attackers.size === 1 ? "" : "s"} bear on it${shield.length < shieldFiles.length ? ", pawn cover is thin" : ""}.`,
      detail: `Danger score ${danger}: enemy pieces hitting the king's squares (minor 2, rook 3, queen 5, as in Stockfish), plus missing shield pawns and no escape square.`,
      evidence: "rules",
      label: `King danger: ${level}`,
      polarity: level === "low" ? "neutral" : "weakness",
      marks: {
        ...emptyMarks(),
        squares: heat.map(({ z, n }, i) => ({ sq: z, tone: "danger" as const, style: n >= 2 ? ("pulse" as const) : ("flood" as const), order: i })),
        arrows: [...attackers].map((a) => {
          const target = zone.find((z) => attackersOf(p, z, enemy).includes(a))!;
          return { from: a, to: target, tone: "danger" as const, thin: true };
        }),
        icons: shield.map((f) => {
          const s = [1, 2].map((d) => toSquare(f, rankIndex(k) + d * fwd)).find((x) => x && p[x]?.type === "p" && p[x]?.color === c)!;
          return { sq: s, icon: "shield" as const, tone: "info" as const };
        }),
        badges: [{ sq: k, text: String(danger), tone: level === "low" ? "info" : "danger" }],
      },
      priority: level === "high" ? 88 : level === "medium" ? 62 : 22,
    });
  }
  return facts;
}
