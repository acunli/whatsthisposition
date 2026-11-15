/**
 * The pawn structures players know by name, recognised from the pawn skeleton alone and
 * for either colour. A structure is what makes plans predictable: it says which files are
 * open, which pawns are targets and which wing each side plays on. Nothing here depends on
 * the opening that led to it or on where the pieces are.
 */
import { COLOR_NAME, other, type Color, type Square } from "../chess/types";
import { emptyMarks, type Marks } from "../facts/types";
import { fileLetter, relSquare, type Features, type SideFeatures, type Wing } from "./features";

export type StructureId =
  | "carlsbad"
  | "chain"
  | "iqp"
  | "hanging"
  | "maroczy"
  | "stonewall"
  | "benoni"
  | "sicilian"
  | "symmetrical"
  | "majorities";

export interface Structure {
  id: StructureId;
  name: string;
  /** How it reads inside a sentence: "an isolated queen's pawn for White". */
  phrase: string;
  /** The side the structure is named for: the one with the isolated pawn, the bind, the minority. */
  side: Color;
  meaning: string;
  marks: Marks;
  /** Chains only: the wing each side's chain points at, and the pawn move that levers it open. */
  chain?: Record<Color, { wing: Wing; lever?: { from: Square; to: Square }; target?: Square }>;
  /** Majorities only: the wing each side has more pawns on. */
  majority?: Partial<Record<Color, Wing>>;
}

/** A pawn move as it is written: "c5" for White, "…c5" for Black. */
export const pawnMove = (c: Color, sq: Square | null) => (sq ? (c === "b" ? `…${sq}` : sq) : "");

const has = (s: SideFeatures, f: number) => s.pawnRanks[f].length > 0;
const at = (s: SideFeatures, f: number, r: number) => s.pawnRanks[f].includes(r);
const ring = (sqs: (Square | null)[], tone: "danger" | "opportunity" | "info" = "info"): Marks => ({
  ...emptyMarks(),
  squares: sqs.filter((s): s is Square => !!s).map((sq) => ({ sq, tone, style: "ring" as const })),
});

/** The first pawn move of `c` on `file` that lands beside an enemy pawn's capture square, if one is possible. */
function lever(f: Features, c: Color, file: number): { from: Square; to: Square } | undefined {
  const me = f.of(c);
  const r = Math.max(-1, ...me.pawnRanks[file]);
  if (r < 0) return undefined;
  const from = relSquare(file, r, c);
  const to = relSquare(file, r + 1, c);
  if (!from || !to || f.p[to]) return undefined;
  return { from, to };
}

export function findStructures(f: Features): Structure[] {
  const out: Structure[] = [];
  const C = 2;
  const D = 3;
  const E = 4;
  const F = 5;
  const sides: [SideFeatures, SideFeatures][] = [
    [f.w, f.b],
    [f.b, f.w],
  ];
  const name = (s: SideFeatures) => COLOR_NAME[s.color];

  // Carlsbad: the d-pawns block each other, one side has traded its c-pawn, the other its e-pawn.
  for (const [me, them] of sides) {
    if (!(at(me, D, 3) && at(them, D, 3))) continue;
    if (has(me, C) || !has(me, E) || has(them, E) || !has(them, C)) continue;
    if (!has(me, 1) || !has(them, 1)) continue;
    const b = lever(f, me.color, 1);
    out.push({
      id: "carlsbad",
      name: "Carlsbad structure",
      phrase: "the Carlsbad structure",
      side: me.color,
      meaning: `The d-pawns block each other; ${name(me)} has the half-open c-file and ${name(them)} the half-open e-file. ${name(me)} usually advances the queenside pawns, two against three, to leave a weak pawn behind (the minority attack). ${name(them)} looks to the e-file, the square in front of ${name(me)}'s e-pawn and the kingside.`,
      marks: {
        ...emptyMarks(),
        bands: [
          { kind: "file", index: C, tone: me.color === "w" ? "white" : "black" },
          { kind: "file", index: E, tone: them.color === "w" ? "white" : "black" },
        ],
        arrows: b ? [{ from: b.from, to: b.to, tone: "idea", dashed: true }] : [],
      },
    });
  }

  // Locked chains: both centre files blocked, one pawn of each pair further forward.
  if (f.centre.locked.includes(D) && f.centre.locked.includes(E)) {
    const head = (s: SideFeatures) => {
      const d = Math.max(...s.pawnRanks[D]);
      const e = Math.max(...s.pawnRanks[E]);
      return d === e ? null : d > e ? D : E;
    };
    const hw = head(f.w);
    const hb = head(f.b);
    if (hw != null && hb != null) {
      const info = (c: Color, h: number) => {
        const wing: Wing = h === D ? "queenside" : "kingside";
        const out2 = h === D ? C : F;
        const lv = lever(f, c, out2);
        // The lever arrives next to the enemy pawn that blocks the head of the chain.
        const me = f.of(c);
        const target = relSquare(h, Math.max(...me.pawnRanks[h]) + 1, c) ?? undefined;
        return { wing, lever: lv, target };
      };
      const cw = info("w", hw);
      const cb = info("b", hb);
      const levers = [cw.lever, cb.lever].filter((x): x is { from: Square; to: Square } => !!x);
      out.push({
        id: "chain",
        name: "Locked pawn chains",
        phrase: "locked pawn chains",
        side: "w",
        meaning: `Both centre files are blocked, so nothing happens in the middle. Each side plays where its chain points: White on the ${cw.wing}, Black on the ${cb.wing}. Lines only open through pawn levers against the chain, and knights do better than bishops until they do.`,
        marks: {
          ...emptyMarks(),
          arrows: levers.map((l) => ({ from: l.from, to: l.to, tone: "idea" as const, dashed: true })),
          squares: [cw.target, cb.target].filter((s): s is Square => !!s).map((sq) => ({ sq, tone: "danger" as const, style: "ring" as const })),
        },
        chain: { w: cw, b: cb },
      });
    }
  }

  for (const [me, them] of sides) {
    const c = me.color;
    // Isolated queen's pawn.
    if (me.pawnRanks[D].length === 1 && me.pawnRanks[D][0] >= 3 && me.pawnRanks[D][0] <= 4 && !has(me, C) && !has(me, E) && !has(them, D)) {
      const sq = relSquare(D, me.pawnRanks[D][0], c);
      const front = relSquare(D, me.pawnRanks[D][0] + 1, c);
      out.push({
        id: "iqp",
        name: "Isolated queen's pawn",
        phrase: `an isolated queen's pawn for ${name(me)}`,
        side: c,
        meaning:
          f.phase === "endgame" || f.phase === "queenless"
            ? `${name(me)}'s d-pawn has no neighbours. With few pieces left it is mostly a weakness: it needs pieces to guard it, and the square in front of it belongs to ${name(them)}.`
            : `${name(me)}'s d-pawn has no neighbours. In the middlegame that buys space, open files beside it and outposts in front of them, so ${name(me)} wants pieces on and an attack; ${name(them)} wants to block the pawn, trade pieces and win it in the endgame.`,
        marks: {
          ...ring([sq], "info"),
          squares: [...ring([sq], "info").squares, ...(front ? [{ sq: front, tone: "info" as const, style: "dashed" as const }] : [])],
        },
      });
    }
    // Hanging pawns.
    if (me.pawnRanks[C].some((r) => r >= 3) && me.pawnRanks[D].some((r) => r >= 3) && !has(me, 1) && !has(me, E) && !has(them, C) && !has(them, D)) {
      const sqs = [relSquare(C, Math.max(...me.pawnRanks[C]), c), relSquare(D, Math.max(...me.pawnRanks[D]), c)];
      out.push({
        id: "hanging",
        name: "Hanging pawns",
        phrase: `hanging pawns for ${name(me)}`,
        side: c,
        meaning: `${name(me)}'s c- and d-pawns stand side by side with no pawn next to them. Abreast they control the squares in front and can advance with force; once one of them has to move, the other is left backward and both become targets on the half-open files.`,
        marks: ring(sqs, "info"),
      });
    }
    // Maroczy bind.
    if (at(me, C, 3) && at(me, E, 3) && !has(me, D) && !has(them, C) && them.pawnRanks[D].length > 0 && Math.max(...them.pawnRanks[D]) <= 2) {
      const d5 = relSquare(D, 4, c);
      const t = them.color;
      const push = (file: number) => pawnMove(t, relSquare(file, 3, t));
      out.push({
        id: "maroczy",
        name: "Maroczy bind",
        phrase: `a Maroczy bind for ${name(me)}`,
        side: c,
        meaning: `${name(me)}'s pawns on the c- and e-files both guard ${d5}, so ${name(them)}'s freeing ${push(D)} is very hard to get in. ${name(me)} has the space and plays slowly; ${name(them)} trades pieces to ease the cramp and aims for the ${push(1)} or ${push(F)} breaks.`,
        marks: {
          ...emptyMarks(),
          squares: [...ring([relSquare(C, 3, c), relSquare(E, 3, c)], "opportunity").squares, ...(d5 ? [{ sq: d5, tone: "info" as const, style: "dashed" as const }] : [])],
        },
      });
    }
    // Stonewall.
    if (at(me, D, 3) && at(me, E, 2) && at(me, F, 3)) {
      const e5 = relSquare(E, 4, c);
      const e4 = relSquare(E, 3, c);
      out.push({
        id: "stonewall",
        name: "Stonewall",
        phrase: `a Stonewall for ${name(me)}`,
        side: c,
        meaning: `${name(me)}'s pawns on the d-, e- and f-files form a wall that holds ${e5} for a knight and points the pieces at the kingside. The price is ${e4}, which no ${name(me)} pawn can cover any more, and a bishop shut in behind the wall.`,
        marks: {
          ...emptyMarks(),
          squares: [
            ...ring([relSquare(D, 3, c), relSquare(E, 2, c), relSquare(F, 3, c)], "info").squares,
            ...(e5 ? [{ sq: e5, tone: "opportunity" as const, style: "dashed" as const }] : []),
            ...(e4 ? [{ sq: e4, tone: "danger" as const, style: "pit" as const }] : []),
          ],
        },
      });
    }
    // Benoni: an advanced d-pawn with the e-pawn behind it, against a queenside majority.
    if (at(me, D, 4) && has(me, E) && !has(me, C) && at(them, D, 2) && at(them, C, 3) && !has(them, E)) {
      out.push({
        id: "benoni",
        name: "Benoni structure",
        phrase: "a Benoni structure",
        side: c,
        meaning: `${name(me)} has the extra pawn in the centre and wants to push the e-pawn through; ${name(them)} has the extra pawn on the queenside and wants to advance it, with the half-open e-file and the long diagonal for the pieces. Whoever gets the break in first usually dictates.`,
        marks: ring([relSquare(D, 4, c), relSquare(C, 3, other(c))], "info"),
      });
    }
    // Open Sicilian type: an e-pawn against d- and e-pawns, a half-open d-file against a half-open c-file.
    if (at(me, E, 3) && !has(me, D) && has(me, C) && !at(me, C, 3) && !has(them, C) && has(them, D) && has(them, E) && Math.max(...them.pawnRanks[D]) <= 3) {
      const hole = at(them, E, 3) && Math.max(...them.pawnRanks[D]) === 2 ? relSquare(D, 4, c) : null;
      out.push({
        id: "sicilian",
        name: "Open Sicilian structure",
        phrase: "an open Sicilian structure",
        side: c,
        meaning: `${name(me)} has more space and the half-open d-file, and usually plays in the centre and on the kingside. ${name(them)} has two centre pawns against one and the half-open c-file, and plays on the queenside; a well-timed break with the d-pawn frees the whole position.${hole ? ` With the e-pawn forward, ${hole} is a square no ${name(them)} pawn can cover.` : ""}`,
        marks: {
          ...emptyMarks(),
          bands: [
            { kind: "file", index: D, tone: c === "w" ? "white" : "black" },
            { kind: "file", index: C, tone: c === "w" ? "black" : "white" },
          ],
          squares: hole ? [{ sq: hole, tone: "danger", style: "pit" }] : [],
        },
      });
    }
  }

  // Symmetrical: the same pawns on the same files and, in the centre, on the same ranks.
  const same = [0, 1, 2, 3, 4, 5, 6, 7].every((file) => f.w.pawnRanks[file].length === f.b.pawnRanks[file].length);
  const mirrored = [C, D, E, F].every((file) => [...f.w.pawnRanks[file]].sort().join() === [...f.b.pawnRanks[file]].sort().join());
  if (same && mirrored && f.w.counts.p >= 5 && !out.length) {
    out.push({
      id: "symmetrical",
      name: "Symmetrical pawns",
      phrase: "symmetrical pawns",
      side: f.turn,
      meaning: "Both sides have the same pawns on the same files, so there is no structural target yet. The difference has to come from the pieces: the better squares, an open file taken first, or the extra move.",
      marks: emptyMarks(),
    });
  }

  // Majorities on opposite wings.
  const wingDiff = (w: Wing) => f.w.wingPawns[w] - f.b.wingPawns[w];
  const q = wingDiff("queenside");
  const k = wingDiff("kingside");
  if (q && k && Math.sign(q) !== Math.sign(k) && !out.some((s) => s.id === "carlsbad" || s.id === "chain")) {
    const wWing: Wing = q > 0 ? "queenside" : "kingside";
    const bWing: Wing = q > 0 ? "kingside" : "queenside";
    out.push({
      id: "majorities",
      name: "Majorities on opposite wings",
      phrase: "pawn majorities on opposite wings",
      side: f.turn,
      meaning: `White has more pawns on the ${wWing}, Black on the ${bWing}. Each majority can make a passed pawn; the one further from the kings is harder to stop in an endgame.`,
      marks: emptyMarks(),
      majority: { w: wWing, b: bWing },
    });
  }
  return out;
}

/** The files of a wing, outermost first. */
export const wingFiles = (w: Wing): number[] => (w === "queenside" ? [0, 1, 2] : w === "kingside" ? [7, 6, 5] : [3, 4]);
export const fileWord = (file: number) => `${fileLetter(file)}-file`;
