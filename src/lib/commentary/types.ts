/**
 * The position read the way a commentator reads it: what kind of position this is, what
 * each side likes and dislikes about it, and the plans that follow, sorted by type.
 * Everything comes from rules over the board (lib/facts) and, where given, the engine's
 * lines; nothing is written per position or per opening.
 */
import type { Color, Square } from "../chess/types";
import type { Evidence, Marks, PeekLine } from "../facts/types";

export type Phase = "opening" | "middlegame" | "queenless" | "endgame";

/** What a type says something about. One position has several types, at most one or two per group. */
export type TypeGroup = "phase" | "centre" | "structure" | "kings" | "character" | "balance";

export interface PositionType {
  id: string;
  group: TypeGroup;
  /** Two to four words: "Closed centre", "Isolated queen's pawn". */
  name: string;
  /** How it reads inside a sentence, when that differs from the name: "an endgame of bishop against knight". */
  phrase?: string;
  /** What that means for how the position is played, in a sentence or two. */
  meaning: string;
  marks: Marks;
  /** The side the type belongs to, when it has one (the side with the isolated pawn). */
  side?: Color;
}

export type Theme = "material" | "king" | "pieces" | "pawns" | "space" | "time" | "lines" | "tactics";

/** One thing a side likes or dislikes about its position. */
export interface Point {
  id: string;
  side: Color;
  good: boolean;
  theme: Theme;
  /** A few words: "The knight on d5", "A king stuck in the centre". */
  title: string;
  /** Why it matters here. */
  text: string;
  marks: Marks;
  /** Higher matters more; used to pick and order. */
  weight: number;
  evidence: Evidence;
}

export type PlanCategory = "attack" | "centre" | "wing" | "improve" | "trade" | "target" | "pawns" | "defend";

export const PLAN_CATEGORY: Record<PlanCategory, { name: string; about: string }> = {
  attack: { name: "Attack the king", about: "Open lines at the king and bring more attackers than there are defenders." },
  centre: { name: "Break in the centre", about: "A pawn break that opens the middle of the board." },
  wing: { name: "Play on a wing", about: "Gain ground on one side of the board with pawns and the pieces behind them." },
  improve: { name: "Improve a piece", about: "Find the piece doing the least and give it a better square." },
  trade: { name: "Trade pieces", about: "Which pieces to swap and which to keep." },
  target: { name: "Go after a weakness", about: "A pawn or square that can't be defended by a pawn, and how to lean on it." },
  pawns: { name: "Pawn play", about: "Passed pawns and the majorities that make them." },
  defend: { name: "Defend first", about: "What has to be solved before anything else." },
};

export interface PlanStep {
  text: string;
  marks: Marks;
}

/** How the engine's lines relate to a plan. */
export interface PlanEngine {
  /** "main": the best line plays it; "other": another top line does; "none": no top line does. */
  follows: "main" | "other" | "none";
  /** "The engine's main line starts it with 14.b4." */
  note?: string;
  line?: PeekLine;
}

export interface StrategicPlan {
  id: string;
  side: Color;
  category: PlanCategory;
  /** "Minority attack on the queenside" */
  title: string;
  /** The feature of the position that makes this the plan. */
  why: string;
  /** How it's carried out, step by step. */
  steps: PlanStep[];
  /** What the opponent does about it, or what it costs. */
  risk?: string;
  weight: number;
  marks: Marks;
  /** The move that starts it, when one move does (for the engine's timing check). */
  key?: { from: Square; to: Square };
  keyUci?: string;
  keySan?: string;
  /** Does a move belong to this plan? Used to find the plan in the engine's lines. */
  match?: (m: { from: Square; to: Square; piece: string; san: string; captured?: string }) => boolean;
  engine?: PlanEngine;
}

export interface SideRead {
  likes: Point[];
  dislikes: Point[];
  plans: StrategicPlan[];
}

export interface Commentary {
  phase: Phase;
  types: PositionType[];
  /** The position in one sentence. */
  headline: string;
  /** Two or three sentences: the balance, why, and what the side to move is after. */
  story: string[];
  sides: Record<Color, SideRead>;
}
