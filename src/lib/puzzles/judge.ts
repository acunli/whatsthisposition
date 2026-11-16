/**
 * Is the move the solver played right? The puzzle's own answer is; so is any move the
 * engine rates about as highly, since a position can hold two good moves and a puzzle
 * that rejects one of them teaches the wrong thing.
 */
import type { Color } from "../chess/types";
import type { Evaluation } from "../engine/score";
import { expectedScore } from "../review/classify";

/** Winning chances a move may give away against the answer and still count. */
export const AS_GOOD = 0.03;

export type Verdict = "answer" | "as-good" | "game-move" | "wrong";

/** A move that needs no engine to judge: the answer itself, or the move played in the game. */
export function judgeAtOnce(uci: string, puzzle: { solution: string[]; task: "better" | "punish"; played: { uci: string } }): Verdict | null {
  if (uci === puzzle.solution[0]) return "answer";
  if (puzzle.task === "better" && uci === puzzle.played.uci) return "game-move";
  return null;
}

/** Any other move, once the engine has looked at it: as good as the answer, or not. */
export function judgeSearched(answer: Evaluation, tried: Evaluation, solver: Color): Verdict {
  // A mate has to stay a mate; otherwise it is the winning chances that are compared.
  if (answer.kind === "mate" && answer.winner === solver) return tried.kind === "mate" && tried.winner === solver ? "as-good" : "wrong";
  return expectedScore(answer, solver) - expectedScore(tried, solver) <= AS_GOOD ? "as-good" : "wrong";
}
