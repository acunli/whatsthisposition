/**
 * Space, measured the way Stockfish's classical evaluation did: safe squares on the
 * central four files (c–f), on a side's 2nd–4th ranks, not attacked by enemy pawns.
 * Squares behind one of your own pawns count twice (they're really yours).
 */
import { ALL_SQUARES, attackersOf, fileIndex, rankIndex, toSquare } from "../chess/board";
import { other, type Color, type Placement, type Square } from "../chess/types";
import { sideName, type Ctx } from "./context";
import { emptyMarks, type Fact } from "./types";

export interface SpaceCount {
  score: number;
  squares: Square[];
}

export function spaceFor(p: Placement, c: Color): SpaceCount {
  const squares: Square[] = [];
  let score = 0;
  const fwd = c === "w" ? 1 : -1;
  for (const sq of ALL_SQUARES) {
    const f = fileIndex(sq);
    const r = c === "w" ? rankIndex(sq) : 7 - rankIndex(sq);
    if (f < 2 || f > 5 || r < 1 || r > 3) continue;
    const x = p[sq];
    if (x?.type === "p" && x.color === c) continue;
    if (attackersOf(p, sq, other(c)).some((a) => p[a]?.type === "p")) continue;
    squares.push(sq);
    // Behind an own pawn on the same file (within three squares)?
    let behind = false;
    for (let d = 1; d <= 3; d++) {
      const s = toSquare(f, rankIndex(sq) + d * fwd);
      if (s && p[s]?.type === "p" && p[s]?.color === c) behind = true;
    }
    score += behind ? 2 : 1;
  }
  return { score, squares };
}

export function spaceFacts(ctx: Ctx): Fact[] {
  const w = spaceFor(ctx.p, "w");
  const b = spaceFor(ctx.p, "b");
  const diff = w.score - b.score;
  const leader: Color = diff >= 0 ? "w" : "b";
  const lead = leader === "w" ? w : b;
  const trail = leader === "w" ? b : w;
  const ordered = (sqs: Square[], c: Color) =>
    [...sqs].sort((x, y) => (c === "w" ? rankIndex(x) - rankIndex(y) : rankIndex(y) - rankIndex(x)));
  return [
    {
      id: "space",
      lens: "control",
      kind: "space",
      side: leader,
      tone: Math.abs(diff) >= 3 ? "opportunity" : "info",
      anchor: lead.squares[0] ?? "e4",
      title:
        Math.abs(diff) < 3
          ? `Space is about even (White ${w.score}, Black ${b.score}).`
          : `${sideName(leader)} has more space: ${lead.score} to ${trail.score} behind the pawns in the centre.`,
      detail:
        "Counted like Stockfish's space term: safe squares on the c–f files in your own half, with squares behind your pawns counting double. More space means more room to manoeuvre.",
      evidence: "rules",
      label: `Space ${w.score}–${b.score}`,
      polarity: Math.abs(diff) >= 3 ? "strength" : "neutral",
      marks: {
        ...emptyMarks(),
        squares: [
          ...ordered(w.squares, "w").map((sq, i) => ({ sq, tone: "white" as const, style: "flood" as const, order: i })),
          ...ordered(b.squares, "b").map((sq, i) => ({ sq, tone: "black" as const, style: "flood" as const, order: i })),
        ],
        badges: [],
      },
      priority: Math.abs(diff) >= 3 ? 48 : 20,
    },
  ];
}
