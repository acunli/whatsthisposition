import { ALL_SQUARES, attackersOf, attacksFrom } from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { PIECE_NAME, PIECE_VALUE, other, type Color, type Placement, type Square } from "../chess/types";
import { describe, enPrise, safeSquares, sideName, the, value, type Ctx } from "./context";
import { emptyMarks, type Fact, type Marks } from "./types";

export interface EngineHints {
  /** First moves of the engine's candidate lines, in rank order. */
  firstMoves: string[];
}

function engineRank(hints: EngineHints | undefined, uci: string): number {
  if (!hints) return -1;
  return hints.firstMoves.indexOf(uci);
}

function marks(partial: Partial<Marks>): Marks {
  return { ...emptyMarks(), ...partial };
}

/** Enemy pieces attacked from `from` that are worth more than the attacker, undefended, or the king. */
export function forkTargets(p: Placement, from: Square): Square[] {
  const attacker = p[from];
  if (!attacker) return [];
  return attacksFrom(p, from).filter((s) => {
    const t = p[s];
    if (!t || t.color === attacker.color) return false;
    if (t.type === "k") return true;
    if (t.type === "p") return false;
    if (value(t) > value(attacker)) return true;
    return attackersOf(p, s, t.color).length === 0;
  });
}

export function threatFacts(ctx: Ctx, hints?: EngineHints): Fact[] {
  const facts: Fact[] = [];
  const { p, turn } = ctx;

  // 1. Check
  if (ctx.inCheck) {
    const king = ALL_SQUARES.find((s) => p[s]?.type === "k" && p[s]?.color === turn)!;
    const checkers = ctx.attackers(king, other(turn));
    const replies = ctx.legal.length;
    facts.push({
      id: `check-${king}`,
      lens: "threats",
      kind: "check",
      side: turn,
      tone: "danger",
      anchor: king,
      title: `${sideName(turn)} is in check from ${checkers.map((c) => the(p, c)).join(" and ")}${replies <= 3 ? `, with only ${replies} legal ${replies === 1 ? "reply" : "replies"}` : ""}.`,
      evidence: "rules",
      marks: marks({
        squares: [{ sq: king, tone: "danger", style: "fill" }],
        arrows: checkers.map((c) => ({ from: c, to: king, tone: "danger" as const })),
      }),
      priority: 100,
    });
  }

  // 2. Mate in one (rules) and other checks for the side to move
  const checks = ctx.legal.filter((m) => m.san.includes("+") || m.san.includes("#"));
  const mates = checks.filter((m) => m.san.includes("#"));
  for (const m of mates.slice(0, 2)) {
    facts.push({
      id: `mate1-${m.lan}`,
      lens: "threats",
      kind: "mate-in-one",
      side: turn,
      tone: "opportunity",
      anchor: m.to,
      title: `${m.san} is checkmate.`,
      evidence: "rules",
      marks: marks({ arrows: [{ from: m.from, to: m.to, tone: "opportunity" }], squares: [{ sq: m.to, tone: "opportunity", style: "ring" }] }),
      priority: 99,
    });
  }
  const otherChecks = checks.filter((m) => !m.san.includes("#"));
  if (otherChecks.length) {
    const ranked = [...otherChecks].sort((a, b) => {
      const ra = engineRank(hints, a.lan);
      const rb = engineRank(hints, b.lan);
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    });
    const shown = ranked.slice(0, 4);
    const inEngine = shown.filter((m) => engineRank(hints, m.lan) >= 0);
    facts.push({
      id: `checks-${turn}`,
      lens: "threats",
      kind: "checks",
      side: turn,
      tone: "opportunity",
      anchor: shown[0].to,
      title: `${sideName(turn)} has ${otherChecks.length} checking move${otherChecks.length > 1 ? "s" : ""}: ${shown.map((m) => m.san).join(", ")}${otherChecks.length > shown.length ? "…" : ""}.`,
      detail: inEngine.length
        ? `The engine's candidates include ${inEngine.map((m) => m.san).join(", ")}. A check is forcing, but not automatically good.`
        : hints
          ? "None of these are among the engine's top candidates. Forcing isn't the same as good."
          : "Checks are forcing moves: the opponent must respond to them.",
      evidence: inEngine.length ? "engine" : "rules",
      marks: marks({ arrows: shown.map((m) => ({ from: m.from, to: m.to, tone: "opportunity" as const, dashed: engineRank(hints, m.lan) < 0 })) }),
      priority: 60,
    });
  }

  // 3. Pieces that can be taken without an even trade
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (!piece || piece.type === "k") continue;
    const ep = enPrise(ctx, sq);
    if (!ep) continue;
    const enemy = other(piece.color);
    const takers = ep.capturers.map((c) => the(p, c)).join(" or ");
    const ownerToMove = piece.color === turn;
    const takesUci = ep.capturers.map((c) => c + sq);
    const engineTakes = !ownerToMove && takesUci.some((u) => engineRank(hints, u) === 0);
    let title: string;
    if (ep.reason === "undefended") {
      title = ownerToMove
        ? `${describe(p, sq)} is attacked by ${takers} and not defended.`
        : `${describe(p, sq)} is undefended: ${sideName(enemy)} can take it with ${takers}.`;
    } else {
      title = ownerToMove
        ? `${describe(p, sq)} is attacked by a cheaper piece (${takers}).`
        : `${describe(p, sq)} is attacked by a cheaper piece (${takers}), so ${sideName(enemy)} gains by taking it.`;
    }
    facts.push({
      id: `enprise-${sq}`,
      lens: "threats",
      kind: ep.reason === "undefended" ? "hanging" : "attacked-by-cheaper",
      side: piece.color,
      tone: "danger",
      anchor: sq,
      title,
      detail: ownerToMove
        ? `It's ${sideName(piece.color)}'s move, so this can still be fixed: move it, defend it, or create a bigger threat.`
        : engineTakes
          ? "The engine's first choice is to take it."
          : hints
            ? "Taking isn't the engine's first choice here, so check what the capture allows before grabbing it."
            : "Counting only direct attackers and defenders.",
      evidence: engineTakes ? "engine" : "rules",
      marks: marks({
        squares: [{ sq, tone: "danger", style: "pulse" }],
        arrows: ep.capturers.map((c) => ({ from: c, to: sq, tone: ownerToMove ? ("danger" as const) : ("opportunity" as const) })),
      }),
      priority: 80 + PIECE_VALUE[piece.type],
    });
  }

  // 4. Pins
  for (const pin of ctx.pins) {
    const pinned = p[pin.pinned]!;
    const behind = p[pin.behind]!;
    facts.push({
      id: `pin-${pin.pinned}`,
      lens: "threats",
      kind: pin.absolute ? "pin-absolute" : "pin-relative",
      side: pinned.color,
      tone: "danger",
      anchor: pin.pinned,
      title: pin.absolute
        ? `${describe(p, pin.pinned)} is pinned to its king by ${the(p, pin.pinner)}; it can't leave the line.`
        : `${describe(p, pin.pinned)} is pinned to the ${PIECE_NAME[behind.type]} on ${pin.behind} by ${the(p, pin.pinner)}.`,
      detail: pin.absolute
        ? "Moving it off the line would be illegal. It also can't defend squares off that line."
        : `If it moves, ${the(p, pin.pinner)} can take the ${PIECE_NAME[behind.type]} behind it.`,
      evidence: "rules",
      marks: marks({
        squares: [
          { sq: pin.pinned, tone: "danger", style: "pulse" },
          { sq: pin.behind, tone: "danger", style: "ring" },
        ],
        arrows: [],
        links: [{ from: pin.pinner, to: pin.behind, tone: "danger", kind: "pin" }],
        icons: [{ sq: pin.pinned, icon: "lock", tone: "danger" }],
      }),
      priority: pin.absolute ? 70 : 55,
    });
  }

  // 5. Forks already on the board
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (!piece) continue;
    const targets = forkTargets(p, sq);
    if (targets.length < 2) continue;
    const victim = other(piece.color);
    const capturable = ctx.capturers(sq, victim);
    facts.push({
      id: `fork-${sq}`,
      lens: "threats",
      kind: "fork",
      side: piece.color,
      tone: "opportunity",
      anchor: sq,
      title: `${describe(p, sq)} attacks ${targets.map((t) => the(p, t)).join(" and ")} at once.`,
      detail: capturable.length
        ? `${sideName(victim)} can take the forking piece with ${capturable.map((c) => the(p, c)).join(" or ")}.`
        : piece.color === turn
          ? `${sideName(victim)} can't save everything if it's ${sideName(piece.color)}'s move now.`
          : `${sideName(victim)} is to move and must deal with both targets.`,
      evidence: "rules",
      marks: marks({
        squares: [{ sq, tone: "opportunity", style: "ring" }, ...targets.map((t) => ({ sq: t, tone: "danger" as const, style: "ring" as const }))],
        arrows: targets.map((t) => ({ from: sq, to: t, tone: "opportunity" as const })),
      }),
      priority: 85,
    });
  }

  // 6. Fork moves available to the side to move
  const forkMoves: { san: string; lan: string; from: Square; to: Square; targets: Square[]; score: number }[] = [];
  for (const m of ctx.legal) {
    const after = placementFromFen(m.after);
    const targets = forkTargets(after, m.to);
    if (targets.length < 2) continue;
    const mover = after[m.to]!;
    const atk = attackersOf(after, m.to, other(turn));
    const safe = !atk.length || (!atk.some((a) => after[a]!.type !== "k" && value(after[a]!) < value(mover)) && attackersOf(after, m.to, turn).length > 0);
    if (!safe) continue;
    const score = targets.reduce((s, t) => s + value(after[t]!), 0) + (engineRank(hints, m.lan) >= 0 ? 50 : 0);
    forkMoves.push({ san: m.san, lan: m.lan, from: m.from, to: m.to, targets, score });
  }
  forkMoves.sort((a, b) => b.score - a.score);
  for (const f of forkMoves.slice(0, 2)) {
    const rank = engineRank(hints, f.lan);
    const after = placementFromFen(ctx.legal.find((m) => m.lan === f.lan)!.after);
    facts.push({
      id: `forkmove-${f.lan}`,
      lens: "threats",
      kind: "fork-move",
      side: turn,
      tone: rank >= 0 ? "opportunity" : "idea",
      anchor: f.to,
      title: `${f.san} would attack ${f.targets.map((t) => the(after, t)).join(" and ")} at once.`,
      detail:
        rank >= 0
          ? `The engine lists ${f.san} as candidate ${rank + 1}.`
          : hints
            ? `The engine doesn't rank ${f.san} among its top moves: the fork may be answered by something stronger.`
            : "The landing square isn't attacked by a cheaper piece.",
      evidence: rank >= 0 ? "engine" : "idea",
      marks: marks({
        arrows: [
          { from: f.from, to: f.to, tone: rank >= 0 ? "opportunity" : "idea", dashed: rank < 0 },
          ...f.targets.map((t) => ({ from: f.to, to: t, tone: "idea" as const, thin: true, dashed: true })),
        ],
        squares: f.targets.map((t) => ({ sq: t, tone: "danger" as const, style: "dashed" as const })),
      }),
      priority: rank >= 0 ? 75 : 50,
    });
  }

  // 7. Overloaded defenders
  for (const color of ["w", "b"] as Color[]) {
    const enemy = other(color);
    const soleDefenderOf = new Map<Square, Square[]>();
    for (const sq of ALL_SQUARES) {
      const piece = p[sq];
      if (!piece || piece.color !== color || piece.type === "k") continue;
      if (!ctx.attackers(sq, enemy).length) continue;
      const defenders = ctx.attackers(sq, color);
      if (defenders.length !== 1) continue;
      const d = defenders[0];
      soleDefenderOf.set(d, [...(soleDefenderOf.get(d) ?? []), sq]);
    }
    for (const [d, guarded] of soleDefenderOf) {
      if (guarded.length < 2) continue;
      facts.push({
        id: `overload-${d}`,
        lens: "threats",
        kind: "overloaded",
        side: color,
        tone: "danger",
        anchor: d,
        title: `${describe(p, d)} is the only defender of both ${guarded.map((g) => the(p, g)).join(" and ")}.`,
        detail: "If it has to recapture on one square, the other piece is left without cover.",
        evidence: "rules",
        marks: marks({
          squares: [{ sq: d, tone: "danger", style: "ring" }, ...guarded.map((g) => ({ sq: g, tone: "info" as const, style: "dashed" as const }))],
          arrows: guarded.map((g) => ({ from: d, to: g, tone: "info" as const, thin: true })),
        }),
        priority: 65,
      });
    }
  }

  // 8. Attacked pieces with (almost) nowhere to go
  for (const sq of ALL_SQUARES) {
    const piece = p[sq];
    if (!piece || piece.type === "k" || piece.type === "p") continue;
    if (!enPrise(ctx, sq)) continue;
    const safe = safeSquares(ctx, sq);
    if (safe.length > 1) continue;
    const existing = facts.find((f) => f.id === `enprise-${sq}`);
    const text =
      safe.length === 0
        ? `${describe(p, sq)} is attacked and has no safe square to go to.`
        : `${describe(p, sq)} is attacked and has only one safe square (${safe[0]}).`;
    if (existing) {
      existing.title = text;
      existing.marks.squares.push(...safe.map((s) => ({ sq: s, tone: "info" as const, style: "dot" as const })));
      existing.priority += 5;
    }
  }

  return facts;
}
