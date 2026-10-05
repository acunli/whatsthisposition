/**
 * Plans are conditional ideas, not predictions. Each one says what would have to
 * hold for it to work, measured on the current board, and whether the idea shows
 * up in any engine line (the only thing that upgrades it from "idea" to "engine").
 */
import { ALL_SQUARES, FILES, attackersOf, attacksFrom, fileIndex, rankIndex, toSquare } from "../chess/board";
import { PIECE_NAME, other, type Color, type Placement, type Square } from "../chess/types";
import { buildVariation } from "../variation";
import { fileState, isOutpost } from "./activity";
import { movePiece, sideName, type Ctx } from "./context";
import { classifyPawns } from "./pawns";
import { emptyMarks, type Evidence, type Marks } from "./types";

export interface Plan {
  id: string;
  side: Color;
  kind: "pawn-break" | "outpost-route" | "rook-file" | "passed-pawn" | "castle";
  title: string;
  /** What must be true for the plan to work. */
  conditions: { text: string; met: boolean }[];
  evidence: Evidence;
  /** e.g. "Engine line 2 plays c5 on move 3" */
  engineNote?: string;
  marks: Marks;
  /** The first move that starts the plan (for timing checks and benefits). */
  keyMove?: { from: Square; to: Square };
  /** Squares a piece passes through on the way (knight routes). */
  route?: Square[];
}

export interface EngineLineLite {
  pv: string[];
}

/** Finds the first ply at which `side` plays a move matching `pred` in any engine line. */
function findInLines(
  fen: string,
  lines: EngineLineLite[],
  side: Color,
  pred: (m: { from: Square; to: Square; piece: string; san: string }) => boolean,
): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const v = buildVariation(fen, lines[i].pv, 16);
    const idx = v.moves.findIndex((m) => m.color === side && pred(m));
    if (idx >= 0) {
      const m = v.moves[idx];
      return `Engine line ${i + 1} plays ${m.san}${idx > 0 ? ` (move ${Math.floor(idx / 2) + 1} of the line)` : " right away"}.`;
    }
  }
  return undefined;
}

function supportCount(p: Placement, sq: Square, side: Color) {
  return { mine: attackersOf(p, sq, side).length, theirs: attackersOf(p, sq, other(side)).length };
}

export function findPlans(ctx: Ctx, lines: EngineLineLite[] = []): Plan[] {
  const { p, fen } = ctx;
  const plans: Plan[] = [];
  const sides: Color[] = [ctx.turn, other(ctx.turn)];

  for (const side of sides) {
    const fwd = side === "w" ? 1 : -1;
    const toMove = side === ctx.turn;

    // Pawn breaks: a pawn advance that attacks an enemy pawn.
    for (const sq of ALL_SQUARES) {
      const x = p[sq];
      if (!x || x.type !== "p" || x.color !== side) continue;
      const steps = [1];
      if ((side === "w" && rankIndex(sq) === 1) || (side === "b" && rankIndex(sq) === 6)) steps.push(2);
      for (const n of steps) {
        const target = toSquare(fileIndex(sq), rankIndex(sq) + n * fwd);
        if (!target || p[target]) break;
        const after = movePiece(p, sq, target);
        const hits = attacksFrom(after, target).filter((s) => p[s]?.type === "p" && p[s]?.color === other(side));
        if (!hits.length) continue;
        const { mine, theirs } = supportCount(after, target, side);
        const supported = mine >= theirs;
        const legalNow = toMove && ctx.legal.some((m) => m.from === sq && m.to === target);
        const note = findInLines(fen, lines, side, (m) => m.from === sq && m.to === target);
        plans.push({
          id: `break-${sq}-${target}`,
          side,
          kind: "pawn-break",
          title: `${sideName(side)} pawn break ${target}, hitting ${hits.join(" and ")}.`,
          conditions: [
            { text: `${target} is covered at least as often as it's attacked (${mine} v ${theirs})`, met: supported },
            { text: toMove ? "It's legal right now" : `${sideName(side)} needs a move first`, met: legalNow },
          ],
          evidence: note ? "engine" : "idea",
          engineNote: note,
          keyMove: { from: sq, to: target },
          marks: {
            ...emptyMarks(),
            arrows: [{ from: sq, to: target, tone: note ? "opportunity" : "idea", dashed: !note }],
            squares: [{ sq: target, tone: supported ? "opportunity" : "danger", style: "dashed" }, ...hits.map((h) => ({ sq: h, tone: "danger" as const, style: "ring" as const }))],
          },
        });
      }
    }

    // Knight routes to outposts (one or two jumps, via safe empty squares).
    for (const sq of ALL_SQUARES) {
      const x = p[sq];
      if (!x || x.type !== "n" || x.color !== side) continue;
      if (isOutpost(p, sq, side)) continue;
      const hop = (from: Square, board: Placement) =>
        attacksFrom(movePiece(board, sq, from), from).filter((t) => !board[t] || t === sq);
      const pawnHit = (s: Square) => attackersOf(p, s, other(side)).some((a) => p[a]?.type === "p");
      let best: { route: Square[]; goal: Square } | null = null;
      for (const a of hop(sq, p)) {
        if (p[a] || pawnHit(a)) continue;
        if (isOutpost(p, a, side)) {
          best = { route: [a], goal: a };
          break;
        }
        if (!best || best.route.length > 1) {
          for (const b of hop(a, movePiece(p, sq, a))) {
            if (p[b] || b === sq) continue;
            if (isOutpost(p, b, side) && !best) best = { route: [a, b], goal: b };
          }
        }
      }
      if (!best) continue;
      const g = best.goal;
      const { mine, theirs } = supportCount(p, g, side);
      const via = best.route.length > 1 ? best.route[0] : null;
      const note = findInLines(fen, lines, side, (m) => m.from === sq && m.to === best!.route[0]);
      plans.push({
        id: `route-${sq}-${g}`,
        side,
        kind: "outpost-route",
        title: `${sideName(side)} knight ${sq} → ${via ? `${via} → ` : ""}${g}, an outpost.`,
        conditions: [
          ...(via ? [{ text: `${via} stays safe for the knight on the way`, met: !attackersOf(p, via, other(side)).length }] : []),
          { text: `${g} stays supported (${mine} v ${theirs} now)`, met: mine >= theirs },
          { text: `${sideName(other(side))} can't trade off the knight right away`, met: !attackersOf(p, g, other(side)).some((a) => ["n", "b"].includes(p[a]!.type)) },
        ],
        evidence: note ? "engine" : "idea",
        engineNote: note,
        keyMove: { from: sq, to: best.route[0] },
        route: [sq, ...best.route],
        marks: {
          ...emptyMarks(),
          arrows: [sq, ...best.route].slice(0, -1).map((from, i) => ({ from, to: best!.route[i], tone: "idea" as const, dashed: true })),
          squares: [{ sq: g, tone: "opportunity", style: "dashed" }],
        },
      });
    }

    // Rooks to open or half-open files.
    for (const sq of ALL_SQUARES) {
      const x = p[sq];
      if (!x || x.type !== "r" || x.color !== side) continue;
      const cur = fileState(p, fileIndex(sq));
      if (!cur[side]) continue; // already on an open/half-open file
      for (const t of attacksFrom(p, sq)) {
        if (p[t] || rankIndex(t) !== rankIndex(sq)) continue;
        const st = fileState(p, fileIndex(t));
        const open = !st.w && !st.b;
        const half = !st[side] && st[other(side)];
        if (!open && !half) continue;
        const note = findInLines(fen, lines, side, (m) => m.from === sq && fileIndex(m.to) === fileIndex(t));
        plans.push({
          id: `rook-${sq}-${t}`,
          side,
          kind: "rook-file",
          title: `${sideName(side)} rook ${sq} → ${t}, onto the ${open ? "open" : "half-open"} ${FILES[fileIndex(t)]}-file.`,
          conditions: [
            { text: `The ${FILES[fileIndex(t)]}-file stays ${open ? "open" : "free of " + sideName(side) + " pawns"}`, met: true },
            { text: `${t} isn't attacked by a cheaper piece`, met: !attackersOf(p, t, other(side)).some((a) => ["p", "n", "b"].includes(p[a]!.type)) },
          ],
          evidence: note ? "engine" : "idea",
          engineNote: note,
          keyMove: { from: sq, to: t },
          marks: { ...emptyMarks(), arrows: [{ from: sq, to: t, tone: note ? "opportunity" : "idea", dashed: !note }] },
        });
        break;
      }
    }

    // Passed pawn advances.
    for (const pi of classifyPawns(p).filter((x) => x.color === side && x.passed)) {
      const stop = toSquare(fileIndex(pi.sq), rankIndex(pi.sq) + fwd);
      if (!stop) continue;
      const { mine, theirs } = supportCount(movePiece(p, pi.sq, stop), stop, side);
      const note = findInLines(fen, lines, side, (m) => m.from === pi.sq);
      plans.push({
        id: `passer-${pi.sq}`,
        side,
        kind: "passed-pawn",
        title: `Push ${sideName(side)}'s passed ${pi.sq[0]}-pawn.`,
        conditions: [
          { text: pi.blockader ? `Remove the blocker on ${stop}` : `${stop} is free`, met: !pi.blockader },
          { text: `${stop} is covered at least as often as it's attacked (${mine} v ${theirs})`, met: mine >= theirs },
        ],
        evidence: note ? "engine" : "idea",
        engineNote: note,
        keyMove: { from: pi.sq, to: stop },
        marks: {
          ...emptyMarks(),
          arrows: [{ from: pi.sq, to: stop, tone: note ? "opportunity" : "idea", dashed: !note }],
          squares: [{ sq: stop, tone: pi.blockader ? "danger" : "opportunity", style: "dashed" }],
        },
      });
    }

    // Castling while still possible.
    const rights = fen.split(" ")[2];
    const rank = side === "w" ? "1" : "8";
    for (const [flag, path, kingTo] of [
      [side === "w" ? "K" : "k", ["f", "g"], "g"],
      [side === "w" ? "Q" : "q", ["b", "c", "d"], "c"],
    ] as [string, string[], string][]) {
      if (!rights.includes(flag)) continue;
      const empty = path.every((f) => !p[`${f}${rank}` as Square]);
      const through = (flag.toLowerCase() === "k" ? ["e", "f", "g"] : ["e", "d", "c"]).map((f) => `${f}${rank}` as Square);
      const safe = through.every((s) => !attackersOf(p, s, other(side)).length);
      const note = findInLines(fen, lines, side, (m) => m.piece === "k" && m.from === `e${rank}` && m.to === `${kingTo}${rank}`);
      plans.push({
        id: `castle-${flag}`,
        side,
        kind: "castle",
        title: `${sideName(side)} castles ${flag.toLowerCase() === "k" ? "kingside" : "queenside"}.`,
        conditions: [
          { text: `${path.map((f) => f + rank).join(", ")} empty`, met: empty },
          { text: `King doesn't pass through an attacked square (${through.join(", ")})`, met: safe },
        ],
        evidence: note ? "engine" : "idea",
        engineNote: note,
        keyMove: { from: `e${rank}` as Square, to: `${kingTo}${rank}` as Square },
        marks: { ...emptyMarks(), arrows: [{ from: `e${rank}` as Square, to: `${kingTo}${rank}` as Square, tone: "idea", dashed: true }] },
      });
    }
  }

  // Engine-backed plans first, then the side to move, then those whose conditions hold.
  const score = (pl: Plan) =>
    (pl.evidence === "engine" ? 100 : 0) + (pl.side === ctx.turn ? 20 : 0) + pl.conditions.filter((c) => c.met).length * 5 - pl.conditions.length;
  return plans.sort((a, b) => score(b) - score(a)).slice(0, 8);
}

export function planPieceName(kind: Plan["kind"]): string {
  return { "pawn-break": "Pawn break", "outpost-route": "Knight route", "rook-file": "Rook lift", "passed-pawn": PIECE_NAME.p + " push", castle: "Castle" }[kind];
}
