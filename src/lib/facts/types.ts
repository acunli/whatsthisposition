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

/**
 * fill: solid tint · flood: tint that washes in (staggered by `order`) · pulse: flashing box
 * ring / dashed: outline · dot: small marker · hatch: striped · pit: a hole in the structure
 */
export type SquareStyle = "fill" | "flood" | "pulse" | "ring" | "dashed" | "dot" | "hatch" | "pit";

export interface SquareMark {
  sq: Square;
  tone: Tone;
  style: SquareStyle;
  /** Animation order for staggered reveals (0 = first). */
  order?: number;
}

/** A line between two squares without an arrowhead: chains, rook links, batteries, pins. */
export interface LinkMark {
  from: Square;
  to: Square;
  tone: Tone;
  kind: "chain" | "link" | "pin" | "xray";
}

export type IconName = "shield" | "flag" | "crown" | "star" | "target" | "lock" | "bolt" | "eye";

export interface IconMark {
  sq: Square;
  icon: IconName;
  tone: Tone;
}

/** A whole file or rank lit up (open files, seventh rank, back rank). */
export interface BandMark {
  kind: "file" | "rank";
  /** 0-based file (a=0) or rank (1=0). */
  index: number;
  tone: Tone;
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
  links?: LinkMark[];
  icons?: IconMark[];
  bands?: BandMark[];
}

export type Polarity = "strength" | "weakness" | "neutral";

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
  /** Is this a plus or a minus for `side`? Filled in by the ledger when absent. */
  polarity?: Polarity;
  /** Two-to-four word label for chips, e.g. "Isolated d5 pawn". */
  label?: string;
}

export interface LegendItem {
  tone: Tone;
  style: SquareStyle | "arrow";
  label: string;
}

export const emptyMarks = (): Marks => ({ squares: [], arrows: [], badges: [], links: [], icons: [], bands: [] });

export function mergeMarks(...all: Marks[]): Marks {
  const out = emptyMarks();
  for (const m of all) {
    out.squares.push(...m.squares);
    out.arrows.push(...m.arrows);
    out.badges.push(...m.badges);
    out.links!.push(...(m.links ?? []));
    out.icons!.push(...(m.icons ?? []));
    out.bands!.push(...(m.bands ?? []));
  }
  return out;
}
