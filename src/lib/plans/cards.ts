/**
 * Plan cards: for each candidate plan (castling, a pawn break, a knight route, a
 * rook lift, pushing a passed pawn), what it gains, what it costs, and its
 * character on four scales. All of it is measured on the board; whether it's good
 * *now* is checked by the engine separately (timing.ts).
 */
import { ALL_SQUARES, FILES, attackersOf, attacksFrom, fileIndex, rankIndex, toSquare } from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, other, type Color, type Placement, type Square } from "../chess/types";
import type { Plan } from "../facts/plans";
import { classifyPawns } from "../facts/pawns";
import { emptyMarks, type Evidence, type Marks, type Tone } from "../facts/types";
import { aims, filePawns, kingZone, relRank, zonePressure } from "../reason/geometry";
import { nm } from "../reason/ideas";
import { buildVariation, type VariationMove } from "../variation";

export interface PlanPoint {
  text: string;
  tone: Tone;
  evidence: Evidence;
  marks: Marks;
}

export interface PlanMeter {
  /** Pressure it adds against the enemy king. */
  attack: number;
  /** Safety it adds to the own king and pieces. */
  defence: number;
  /** Lasting gains: structure, outposts, files, passed pawns, space. */
  longTerm: number;
  /** What can go wrong: weakened king, loose pieces, engine cost. */
  risk: number;
}

export type PlanStyle = "Aggressive" | "Defensive" | "Positional" | "Risky" | "Balanced";

export interface PlanCard {
  id: string;
  side: Color;
  kind: Plan["kind"];
  title: string;
  /** The move that starts the plan, in SAN when it can be played from this position. */
  keyUci?: string;
  keySan?: string;
  benefits: PlanPoint[];
  drawbacks: PlanPoint[];
  meter: PlanMeter;
  style: PlanStyle;
  conditions: Plan["conditions"];
  engineNote?: string;
  marks: Marks;
}

const pt = (text: string, tone: Tone, marks: Partial<Marks> = {}, evidence: Evidence = "rules"): PlanPoint => ({ text, tone, evidence, marks: { ...emptyMarks(), ...marks } });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const times = (n: number) => (n === 0 ? "not at all" : n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** The position with `side` to move (the plan's side), or null if that would be illegal. */
function asSide(fen: string, side: Color): string | null {
  const parts = fen.split(" ");
  if (parts[1] === side) return fen;
  parts[1] = side;
  parts[3] = "-";
  const f = parts.join(" ");
  // The side that "passes" must not be in check: then the other side could take the king.
  const p = placementFromFen(f);
  const k = ALL_SQUARES.find((s) => p[s]?.type === "k" && p[s]!.color === other(side));
  if (k && attackersOf(p, k, side).length) return null;
  return f;
}

/** Pawns of `side` on the three files around `k`, one or two ranks in front of it. */
function shield(p: Placement, k: Square, side: Color): Square[] {
  const fwd = side === "w" ? 1 : -1;
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++)
    for (const dr of [1, 2]) {
      const s = toSquare(fileIndex(k) + df, rankIndex(k) + dr * fwd);
      if (s && p[s]?.type === "p" && p[s]!.color === side) out.push(s);
    }
  return out;
}

function kingOf(p: Placement, c: Color) {
  return ALL_SQUARES.find((s) => p[s]?.type === "k" && p[s]!.color === c) ?? null;
}

function castlingPoints(p: Placement, after: Placement, side: Color, kingTo: Square, rookTo: Square, benefits: PlanPoint[], drawbacks: PlanPoint[], m: PlanMeter) {
  const them = other(side);
  const cover = shield(after, kingTo, side);
  if (cover.length >= 3) {
    benefits.push(pt(`The king tucks in behind ${cover.length} pawns (${cover.join(", ")}).`, "opportunity", { squares: cover.map((s) => ({ sq: s, tone: "opportunity" as const, style: "ring" as const })) }));
    m.defence += 0.55;
  } else if (cover.length === 2) {
    benefits.push(pt(`The king gets two pawns of cover (${cover.join(", ")}).`, "opportunity", { squares: cover.map((s) => ({ sq: s, tone: "opportunity" as const, style: "ring" as const })) }));
    m.defence += 0.4;
  } else {
    drawbacks.push(pt(`Only ${cover.length ? `one pawn (${cover[0]})` : "no pawns"} would shield the king on ${kingTo}.`, "danger", { squares: [{ sq: kingTo, tone: "danger", style: "ring" }] }));
    m.risk += 0.3;
    m.defence += 0.15;
  }
  // Centre files the king leaves.
  const from = `e${side === "w" ? 1 : 8}` as Square;
  const eOpen = !filePawns(p, 4)[side];
  if (eOpen && p[from]?.type === "k") {
    benefits.push(pt(`It gets the king off the ${filePawns(p, 4)[them] ? "half-open" : "open"} e-file.`, "opportunity", { bands: [{ kind: "file", index: 4, tone: "danger" }] }));
    m.defence += 0.2;
  }
  // Where the rook lands.
  const rf = fileIndex(rookTo);
  const fp = filePawns(after, rf);
  const aim = aims(after, rookTo).find((a) => a.dir[0] === 0);
  if (!fp[side]) {
    const kind = fp[them] ? "half-open" : "open";
    benefits.push(
      pt(`The rook arrives on the ${kind} ${FILES[rf]}-file${aim ? `, already aiming at ${nm(after, aim.target)}` : ""}.`, "opportunity", {
        bands: [{ kind: "file", index: rf, tone: "opportunity" }],
        arrows: aim ? [{ from: rookTo, to: aim.target, tone: "opportunity" }] : [],
      }),
    );
    m.longTerm += 0.2;
    m.attack += aim ? 0.15 : 0.05;
  } else benefits.push(pt(`The rook comes to ${rookTo}, closer to the centre.`, "info"));
  // Danger already pointing at that wing.
  const pressure = zonePressure(after, kingTo, them);
  if (pressure >= 3) {
    const attackers = [...new Set(kingZone(kingTo).flatMap((s) => attackersOf(after, s, them)))].slice(0, 3);
    drawbacks.push(
      pt(`${COLOR_NAME[them]}'s pieces already aim at that wing: ${attackers.map((a) => nm(after, a)).join(", ")}.`, "danger", {
        arrows: attackers.map((a) => ({ from: a, to: kingTo, tone: "danger" as const })),
      }),
    );
    m.risk += Math.min(0.4, pressure * 0.06);
  }
  const nearFiles = [-1, 0, 1].map((d) => fileIndex(kingTo) + d).filter((f) => f >= 0 && f < 8);
  const openNear = nearFiles.filter((f) => !filePawns(after, f)[side]);
  if (openNear.length) {
    drawbacks.push(pt(`The ${openNear.map((f) => FILES[f]).join("- and ")}-file${openNear.length > 1 ? "s" : ""} next to the king ${openNear.length > 1 ? "have" : "has"} no ${COLOR_NAME[side]} pawn.`, "danger", { bands: openNear.map((f) => ({ kind: "file" as const, index: f, tone: "danger" as const })) }));
    m.risk += 0.15 * openNear.length;
  }
  // Opposite wings: a race of pawn storms.
  const theirK = kingOf(after, them);
  if (theirK && Math.abs(fileIndex(theirK) - fileIndex(kingTo)) >= 4 && (fileIndex(theirK) <= 2 || fileIndex(theirK) >= 5)) {
    benefits.push(pt(`The kings end up on opposite wings: both sides can throw pawns at the enemy king.`, "idea", { squares: [{ sq: theirK, tone: "danger", style: "ring" }] }, "idea"));
    m.attack += 0.3;
    m.risk += 0.15;
  }
}

export function planCard(fen: string, plan: Plan): PlanCard {
  const side = plan.side;
  const them = other(side);
  const p = placementFromFen(fen);
  const benefits: PlanPoint[] = [];
  const drawbacks: PlanPoint[] = [];
  const m: PlanMeter = { attack: 0, defence: 0, longTerm: 0, risk: 0 };
  const sideFen = asSide(fen, side);
  let mv: VariationMove | undefined;
  if (sideFen && plan.keyMove) mv = buildVariation(sideFen, [`${plan.keyMove.from}${plan.keyMove.to}`], 1).moves[0];
  const after = mv ? placementFromFen(mv.fenAfter) : p;

  switch (plan.kind) {
    case "castle": {
      const kingTo = plan.keyMove!.to;
      const rookTo = `${kingTo[0] === "g" ? "f" : "d"}${kingTo[1]}` as Square;
      castlingPoints(p, after, side, kingTo, rookTo, benefits, drawbacks, m);
      break;
    }
    case "pawn-break": {
      const { from, to } = plan.keyMove!;
      const hits = attacksFrom(after, to).filter((s) => after[s]?.type === "p" && after[s]!.color === them);
      for (const h of hits.slice(0, 1)) {
        // If pawns are exchanged, the file the enemy pawn stood on opens for our pieces.
        const f = fileIndex(h);
        const heavy = ALL_SQUARES.filter((s) => after[s]?.color === side && (after[s]!.type === "r" || after[s]!.type === "q"));
        benefits.push(
          pt(`It challenges ${nm(after, h)}; if pawns are exchanged, the ${FILES[f]}-file opens${heavy.length ? ` for ${COLOR_NAME[side]}'s ${heavy.some((s) => after[s]!.type === "r") ? "rooks" : "queen"}` : ""}.`, "opportunity", {
            arrows: [{ from: to, to: h, tone: "opportunity" }],
            bands: [{ kind: "file", index: f, tone: "opportunity" }],
          }),
        );
        m.longTerm += 0.25;
      }
      if (relRank(to, side) >= 4) {
        benefits.push(pt(`The pawn on ${to} gains space and cramps the pieces behind it.`, "opportunity", { squares: [{ sq: to, tone: "opportunity", style: "fill" }] }));
        m.longTerm += 0.15;
      }
      const theirK = kingOf(after, them);
      if (theirK && Math.abs(fileIndex(to) - fileIndex(theirK)) <= 1 && relRank(theirK, side) >= 6) {
        benefits.push(pt(`The break is aimed at the ${COLOR_NAME[them]} king's cover.`, "opportunity", { squares: [{ sq: theirK, tone: "danger", style: "ring" }] }));
        m.attack += 0.45;
      }
      // Squares the pawn stops guarding when it moves on.
      const guarded = attacksFrom(p, from).filter((s) => !attackersOf(after, s, side).some((a) => after[a]!.type === "p"));
      const hole = guarded.find((s) => relRank(s, side) >= 2 && relRank(s, side) <= 4 && attackersOf(after, s, them).length > 0);
      if (hole) {
        drawbacks.push(pt(`${hole} is no longer covered by a pawn: ${COLOR_NAME[them]}'s pieces could use it.`, "danger", { squares: [{ sq: hole, tone: "danger", style: "pit" }] }));
        m.risk += 0.2;
      }
      const myK = kingOf(p, side);
      if (myK && Math.abs(fileIndex(from) - fileIndex(myK)) <= 1 && relRank(from, side) <= 2 && relRank(myK, side) === 0) {
        drawbacks.push(pt(`The pawn comes from in front of ${COLOR_NAME[side]}'s own king, loosening its cover.`, "danger", { squares: [{ sq: from, tone: "danger", style: "dashed" }] }));
        m.risk += 0.25;
      }
      const sup = attackersOf(after, to, side).length;
      const att = attackersOf(after, to, them).length;
      if (att > sup) {
        drawbacks.push(pt(`${to} is attacked ${times(att)} and defended ${times(sup)}: the pawn could simply be lost.`, "danger", { squares: [{ sq: to, tone: "danger", style: "ring" }] }));
        m.risk += 0.3;
      }
      break;
    }
    case "outpost-route": {
      const route = plan.route ?? [];
      const goal = route[route.length - 1];
      if (goal) {
        const there = { ...p };
        delete there[route[0]];
        there[goal] = { type: "n", color: side };
        const targets = attacksFrom(there, goal).filter((s) => there[s]?.color === them && there[s]!.type !== "p");
        benefits.push(pt(`On ${goal} the knight sits on an outpost: a pawn defends it and no enemy pawn can chase it away.`, "opportunity", { squares: [{ sq: goal, tone: "opportunity", style: "fill" }] }));
        if (targets.length) benefits.push(pt(`From ${goal} it would hit ${targets.slice(0, 2).map((t) => nm(there, t)).join(" and ")}.`, "opportunity", { arrows: targets.slice(0, 2).map((t) => ({ from: goal, to: t, tone: "opportunity" as const })) }));
        const theirK = kingOf(p, them);
        if (theirK && kingZone(theirK).some((z) => attacksFrom(there, goal).includes(z))) m.attack += 0.3;
        m.longTerm += 0.55;
        if (route.length > 2) {
          drawbacks.push(pt(`It takes ${route.length - 1} moves to get there; ${COLOR_NAME[them]} gets time to react.`, "info"));
          m.risk += 0.1;
        }
        if (attackersOf(p, goal, them).some((a) => p[a]!.type === "n" || p[a]!.type === "b")) {
          drawbacks.push(pt(`${COLOR_NAME[them]} can trade it off with a minor piece once it arrives.`, "danger"));
          m.risk += 0.15;
        }
      }
      break;
    }
    case "rook-file": {
      const { to } = plan.keyMove!;
      const aim = aims(after, to).find((a) => a.dir[0] === 0);
      benefits.push(
        pt(`The rook takes the ${plan.title.includes("half-open") ? "half-open" : "open"} ${to[0]}-file${aim ? `, aiming at ${nm(after, aim.target)}` : ""}.`, "opportunity", {
          bands: [{ kind: "file", index: fileIndex(to), tone: "opportunity" }],
          arrows: aim ? [{ from: to, to: aim.target, tone: "opportunity" }] : [],
        }),
      );
      m.longTerm += 0.35;
      const seventh = toSquare(fileIndex(to), side === "w" ? 6 : 1);
      if (seventh && !filePawns(after, fileIndex(to)).w && !filePawns(after, fileIndex(to)).b) {
        benefits.push(pt(`Later it can invade on ${seventh}.`, "idea", { squares: [{ sq: seventh, tone: "opportunity", style: "dashed" }] }, "idea"));
        m.attack += 0.15;
      }
      break;
    }
    case "passed-pawn": {
      const { to } = plan.keyMove!;
      const left = 7 - relRank(to, side);
      benefits.push(pt(`The passed pawn moves to ${to}, ${left} square${left === 1 ? "" : "s"} from queening: ${COLOR_NAME[them]}'s pieces have to stop it.`, "opportunity", { arrows: [{ from: plan.keyMove!.from, to, tone: "opportunity" }] }));
      m.longTerm += 0.4 + (relRank(to, side) >= 5 ? 0.3 : 0);
      m.attack += relRank(to, side) >= 5 ? 0.2 : 0;
      const sup = attackersOf(after, to, side).length;
      const att = attackersOf(after, to, them).length;
      if (att > sup) {
        drawbacks.push(pt(`On ${to} it would be attacked ${times(att)} and defended ${times(sup)}.`, "danger", { squares: [{ sq: to, tone: "danger", style: "ring" }] }));
        m.risk += 0.35;
      }
      const pi = classifyPawns(p).find((x) => x.sq === plan.keyMove!.from);
      if (pi?.blockader) drawbacks.push(pt(`${nm(p, pi.blockader)} blocks the way.`, "danger", { squares: [{ sq: pi.blockader, tone: "danger", style: "ring" }] }));
      break;
    }
  }

  const meter: PlanMeter = { attack: clamp01(m.attack), defence: clamp01(m.defence), longTerm: clamp01(m.longTerm), risk: clamp01(m.risk) };
  return {
    id: plan.id,
    side,
    kind: plan.kind,
    title: plan.title,
    keyUci: mv?.uci,
    keySan: mv?.san,
    benefits,
    drawbacks,
    meter,
    style: styleOf(meter),
    conditions: plan.conditions,
    engineNote: plan.engineNote,
    marks: plan.marks,
  };
}

export function styleOf(m: PlanMeter): PlanStyle {
  if (m.risk >= 0.6) return "Risky";
  const top = Math.max(m.attack, m.defence, m.longTerm);
  if (top < 0.25) return "Balanced";
  if (top === m.attack) return "Aggressive";
  if (top === m.defence) return "Defensive";
  return "Positional";
}

export const PLAN_KIND_LABEL: Record<Plan["kind"], string> = {
  castle: "Castling",
  "pawn-break": "Pawn break",
  "outpost-route": "Knight route",
  "rook-file": "Rook to a file",
  "passed-pawn": "Passed pawn",
};

export const pieceWord = (t: string) => PIECE_NAME[t as keyof typeof PIECE_NAME];
