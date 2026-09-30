import { Chess } from "chess.js";
import { attackersOf, fileIndex, FILES, rankIndex, toSquare } from "../chess/board";
import { other, type Color, type Placement, type Square } from "../chess/types";
import { describe, kingOf, listSquares, sideName, type Ctx } from "./context";
import { emptyMarks, type Fact, type SquareMark } from "./types";

export function kingZone(k: Square): Square[] {
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const s = toSquare(fileIndex(k) + df, rankIndex(k) + dr);
      if (s) out.push(s);
    }
  return out;
}

/** Squares next to the king that it could step to right now (ignoring whose move it is). */
export function escapeSquares(p: Placement, color: Color): Square[] {
  const k = Object.entries(p).find(([, v]) => v?.type === "k" && v.color === color)?.[0] as Square | undefined;
  if (!k) return [];
  const without: Placement = { ...p };
  delete without[k];
  return kingZone(k).filter((s) => {
    if (p[s]?.color === color) return false;
    return attackersOf(without, s, other(color)).length === 0;
  });
}

function checksIfToMove(ctx: Ctx, color: Color): { san: string; from: Square; to: Square }[] {
  if (color === ctx.turn) {
    return ctx.legal.filter((m) => /[+#]/.test(m.san)).map((m) => ({ san: m.san, from: m.from, to: m.to }));
  }
  if (ctx.inCheck) return [];
  const parts = ctx.fen.split(" ");
  parts[1] = color;
  parts[3] = "-";
  try {
    const c = new Chess(parts.join(" "));
    return c
      .moves({ verbose: true })
      .filter((m) => /[+#]/.test(m.san))
      .map((m) => ({ san: m.san, from: m.from, to: m.to }));
  } catch {
    return [];
  }
}

export function kingFacts(ctx: Ctx): Fact[] {
  const facts: Fact[] = [];
  const { p } = ctx;
  for (const color of ["w", "b"] as Color[]) {
    const k = kingOf(ctx, color);
    if (!k) continue;
    const enemy = other(color);
    const name = sideName(color);
    const zone = kingZone(k);
    const escapes = escapeSquares(p, color);
    const attackedZone = zone.filter((s) => ctx.attackers(s, enemy).length > 0);

    // Escape squares
    facts.push({
      id: `escapes-${color}`,
      lens: "king",
      kind: "escape-squares",
      side: color,
      tone: escapes.length <= 1 ? "danger" : "info",
      anchor: k,
      title:
        escapes.length === 0
          ? `${name}'s king has no free square to step to.`
          : `${name}'s king has ${escapes.length} free square${escapes.length > 1 ? "s" : ""}: ${escapes.join(", ")}.`,
      detail:
        escapes.length === 0
          ? "Any check that can't be blocked or captured would be mate. Watch the back rank and diagonals."
          : "Squares next to the king that are empty or hold an enemy piece, and aren't attacked.",
      evidence: "rules",
      marks: {
        ...emptyMarks(),
        squares: [
          { sq: k, tone: escapes.length <= 1 ? "danger" : "info", style: "ring" },
          ...escapes.map((s) => ({ sq: s, tone: "info" as const, style: "dot" as const })),
        ],
      },
      priority: escapes.length === 0 ? 70 : 30,
    });

    // Enemy pieces bearing on the king zone
    const attackerSquares = [...new Set(attackedZone.flatMap((s) => ctx.attackers(s, enemy)))].filter((a) => p[a]!.type !== "k");
    if (attackerSquares.length) {
      facts.push({
        id: `zone-${color}`,
        lens: "king",
        kind: "king-zone-attackers",
        side: color,
        tone: attackerSquares.length >= 3 ? "danger" : "info",
        anchor: k,
        title: `${attackerSquares.length} ${sideName(enemy)} piece${attackerSquares.length > 1 ? "s" : ""} hit${attackerSquares.length > 1 ? "" : "s"} squares next to ${name}'s king: ${listSquares(p, attackerSquares, 4)}.`,
        detail: `${attackedZone.length} of the ${zone.length} squares around the king are attacked.`,
        evidence: "rules",
        marks: {
          ...emptyMarks(),
          squares: attackedZone.map((s): SquareMark => ({ sq: s, tone: "danger", style: "hatch" })),
          arrows: attackerSquares.map((a) => {
            const target = attackedZone.find((s) => ctx.attackers(s, enemy).includes(a))!;
            return { from: a, to: target, tone: "danger" as const, thin: true };
          }),
        },
        priority: 40 + attackerSquares.length * 5,
      });
    }

    // Pawn cover and open files near a king on its own side of the board
    const homeRank = color === "w" ? 0 : 7;
    const forward = color === "w" ? 1 : -1;
    const kf = fileIndex(k);
    const kr = rankIndex(k);
    const onHomeRanks = Math.abs(kr - homeRank) <= 1;
    if (onHomeRanks) {
      const files = [kf - 1, kf, kf + 1].filter((f) => f >= 0 && f <= 7);
      const missing: number[] = [];
      for (const f of files) {
        const shield = [1, 2].some((d) => {
          const s = toSquare(f, kr + d * forward);
          return !!s && p[s]?.type === "p" && p[s]?.color === color;
        });
        if (!shield) missing.push(f);
      }
      const flank = kf <= 2 || kf >= 5;
      if (flank && missing.length) {
        facts.push({
          id: `shield-${color}`,
          lens: "king",
          kind: "pawn-shield",
          side: color,
          tone: missing.length >= 2 ? "danger" : "info",
          anchor: k,
          title: `No ${name} pawn shields the king on the ${missing.map((f) => FILES[f]).join("- and ")}-file${missing.length > 1 ? "s" : ""}.`,
          detail: "Pawns one or two squares in front of a castled king block checks and keep enemy pieces out.",
          evidence: "rules",
          marks: {
            ...emptyMarks(),
            squares: missing.map((f) => ({ sq: toSquare(f, kr + forward)!, tone: "danger" as const, style: "dashed" as const })),
          },
          priority: 35 + missing.length * 5,
        });
      }
      for (const f of files) {
        const fileSquares = Array.from({ length: 8 }, (_, r) => toSquare(f, r)!);
        const ownPawn = fileSquares.some((s) => p[s]?.type === "p" && p[s]?.color === color);
        if (ownPawn) continue;
        const heavy = fileSquares.filter((s) => p[s]?.color === enemy && (p[s]?.type === "r" || p[s]?.type === "q"));
        if (!heavy.length) continue;
        facts.push({
          id: `openfile-${color}-${f}`,
          lens: "king",
          kind: "open-file-at-king",
          side: color,
          tone: "danger",
          anchor: heavy[0],
          title: `${describe(p, heavy[0])} stands on the ${FILES[f]}-file next to ${name}'s king, with no ${name} pawn on that file.`,
          evidence: "rules",
          marks: {
            ...emptyMarks(),
            squares: fileSquares.filter((s) => !p[s]).map((s) => ({ sq: s, tone: "danger" as const, style: "hatch" as const })),
            arrows: [{ from: heavy[0], to: toSquare(f, kr)!, tone: "danger", thin: true }],
          },
          priority: 50,
        });
      }
    } else if (kf >= 2 && kf <= 5) {
      const queens = Object.values(p).some((x) => x?.type === "q" && x.color === enemy);
      if (queens && Math.abs(kr - homeRank) <= 2) {
        facts.push({
          id: `center-${color}`,
          lens: "king",
          kind: "king-in-center",
          side: color,
          tone: "danger",
          anchor: k,
          title: `${name}'s king is still in the centre with the enemy queen on the board.`,
          evidence: "rules",
          marks: { ...emptyMarks(), squares: [{ sq: k, tone: "danger", style: "ring" }] },
          priority: 45,
        });
      }
    }

    // Checks the enemy has (now, or if it were their move)
    const checks = checksIfToMove(ctx, enemy);
    if (checks.length) {
      const enemyToMove = enemy === ctx.turn;
      const mates = checks.filter((c) => c.san.includes("#"));
      const shown = (mates.length ? mates : checks).slice(0, 3);
      facts.push({
        id: `checks-against-${color}`,
        lens: "king",
        kind: "available-checks",
        side: color,
        tone: mates.length ? "danger" : "info",
        anchor: k,
        title: mates.length
          ? `${enemyToMove ? `${sideName(enemy)} can mate now` : `If it were ${sideName(enemy)}'s move, ${shown[0].san} would be mate`}: ${shown.map((c) => c.san).join(", ")}.`
          : `${enemyToMove ? `${sideName(enemy)} can check with` : `If it were ${sideName(enemy)}'s move, checks would include`} ${shown.map((c) => c.san).join(", ")}${checks.length > shown.length ? ` (${checks.length} in all)` : ""}.`,
        detail: enemyToMove ? undefined : `${name} may need to deal with these before they become real.`,
        evidence: "rules",
        marks: {
          ...emptyMarks(),
          arrows: shown.map((c) => ({ from: c.from, to: c.to, tone: mates.length ? ("danger" as const) : ("info" as const), dashed: !enemyToMove })),
        },
        priority: mates.length ? 90 : 25,
      });
    }
  }
  return facts;
}
