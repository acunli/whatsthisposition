import type { Color, Square } from "../chess/types";

export type LensId = "threats" | "king" | "pawns" | "activity" | "control" | "material";

/**
 * Tones have one meaning everywhere in the app:
 * - danger: something at risk or weak (a hanging piece, an exposed king, a weak pawn)
 * - opportunity: a strength or a way to exploit something (a fork, a passed pawn, an outpost)
 * - info: neutral geometry (lines, escape squares, defenders)
 * - white / black: which side controls a square
 * - idea: a conditional plan, not a proven line
 */
export type Tone = "danger" | "opportunity" | "info" | "white" | "black" | "idea";

/**
 * Where a claim comes from:
 * - rules: follows from the placement and legal moves alone
 * - engine: backed by Stockfish's search
 * - idea: a strategic interpretation that may or may not work
 */
export type Evidence = "rules" | "engine" | "idea";

export type SquareStyle = "fill" | "ring" | "dashed" | "dot" | "hatch";

export interface SquareMark {
  sq: Square;
  tone: Tone;
  style: SquareStyle;
}

export interface ArrowMark {
  from: Square;
  to: Square;
  tone: Tone;
  dashed?: boolean;
  /** Thin arrows are used for secondary context. */
  thin?: boolean;
}

export interface BadgeMark {
  sq: Square;
  text: string;
  tone: Tone;
}

export interface Marks {
  squares: SquareMark[];
  arrows: ArrowMark[];
  badges: BadgeMark[];
}

export interface Fact {
  id: string;
  lens: LensId;
  kind: string;
  /** Whose piece / king / pawns the fact is about. */
  side: Color;
  tone: Tone;
  anchor: Square;
  /** One short sentence, anchored to the board. */
  title: string;
  /** Optional extra explanation shown on demand. */
  detail?: string;
  evidence: Evidence;
  marks: Marks;
  /** Higher sorts first. */
  priority: number;
}

export interface LegendItem {
  tone: Tone;
  style: SquareStyle | "arrow";
  label: string;
}

export const emptyMarks = (): Marks => ({ squares: [], arrows: [], badges: [] });

export function mergeMarks(...all: Marks[]): Marks {
  const out = emptyMarks();
  for (const m of all) {
    out.squares.push(...m.squares);
    out.arrows.push(...m.arrows);
    out.badges.push(...m.badges);
  }
  return out;
}
