import type { Evaluation } from "../engine/score";
import type { Evidence, Marks, PeekLine, Tone } from "../facts/types";

/** What a move does, in chess terms. Ordered roughly from concrete to strategic. */
export type IdeaKind =
  | "mate"
  | "material"
  | "threat"
  | "parry"
  | "fork"
  | "pin"
  | "skewer"
  | "attack"
  | "king-attack"
  | "line"
  | "battery"
  | "seventh"
  | "outpost"
  | "centre"
  | "activate"
  | "restrict"
  | "trade"
  | "defender"
  | "pawn-break"
  | "passed"
  | "structure"
  | "space"
  | "castle"
  | "king-safety"
  | "luft"
  | "development"
  | "defence"
  | "prepare"
  | "promotion"
  | "check"
  | "concession";

export interface Idea {
  kind: IdeaKind;
  /** Short verb phrase for the headline, e.g. "takes the half-open h-file". */
  phrase: string;
  /** The full sentence shown in the list. */
  text: string;
  tone: Tone;
  evidence: Evidence;
  marks: Marks;
  /** How much the idea matters here (higher first). Engine-confirmed ideas weigh more. */
  weight: number;
  /** A line the sentence refers to, for the hover preview. */
  line?: PeekLine;
}

export interface LineStory {
  /** Moves in score-sheet form, e.g. "22.Qe3 Qh6 23.Qxh6 Rxh6". */
  moves: string;
  /** What happens along the line: trades, material, mates. */
  text: string;
  eval: Evaluation;
  line?: PeekLine;
}

export interface Alternative {
  san: string;
  /** Why it's worse, in one sentence, with the engine's numbers. */
  text: string;
  marks: Marks;
  pv: string[];
  line?: PeekLine;
}

export interface MoveReasoning {
  uci: string;
  san: string;
  label: string;
  /** One sentence: the move and its main ideas. */
  headline: string;
  ideas: Idea[];
  line?: LineStory;
  /** For a strong move: why the next best isn't as good. */
  alternatives: Alternative[];
  /** What the opponent was threatening before the move, and whether the move deals with it. */
  opponentThreat?: { san: string; text: string; parried: boolean; marks: Marks; line?: PeekLine };
  /** The opponent's answer in the engine line and what it does. */
  refutation?: { san: string; text: string; marks: Marks; line?: PeekLine };
}
