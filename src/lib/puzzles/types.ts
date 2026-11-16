/**
 * Puzzles made from a player's own games: every mistake becomes a position to solve, and
 * the mistakes together say what the player gets wrong most (build.ts, profile.ts).
 */
import type { Color } from "../chess/types";
import type { Evaluation } from "../engine/score";

/** What went wrong, in chess terms. */
export type Motif = "mate" | "hanging" | "fork" | "pin" | "skewer" | "defender" | "promotion" | "tactic" | "win" | "opening" | "endgame" | "positional";

/**
 * How it went wrong: a chance the player didn't take ("missed"), something the player's move
 * let the opponent do ("allowed"), or a move that lost ground without losing material ("slip").
 */
export type Way = "missed" | "allowed" | "slip";

export type GamePhase = "opening" | "middlegame" | "endgame";

/** One mistake of the player's, classified. */
export interface Slip {
  /** `${way}:${motif}`: the weakness it counts towards. */
  key: string;
  way: Way;
  motif: Motif;
  phase: GamePhase;
  /** Winning chances given away by the move, 0–1. */
  loss: number;
  /** Fewer than 30 seconds were left on the clock (when the PGN has clocks). */
  rushed: boolean;
  /** Index of the game in the set, and the move. */
  game: number;
  ply: number;
  /** The puzzle made from it, when the position has one clear answer. */
  puzzle?: string;
}

export interface Puzzle {
  id: string;
  /** The weakness it trains. */
  key: string;
  way: Way;
  motif: Motif;
  phase: GamePhase;
  /** The position to solve, and who is to move in it (the side the solver plays). */
  fen: string;
  solver: Color;
  /**
   * "better": the position before the player's mistake, to find the move that was there.
   * "punish": the position after it, to find the opponent's answer and see why it was a mistake.
   */
  task: "better" | "punish";
  /** The answer and how it goes on (UCI, from `fen`). */
  solution: string[];
  /** The engine's evaluation of the answer. */
  eval: Evaluation;
  /** The player's move in the game, as written ("23.Qd2"), and the position it was played in. */
  played: { label: string; uci: string; fen: string };
  /** What followed the player's move in the engine's view (UCI, from the position after it). */
  punishment: string[];
  /** Where it comes from. */
  source: { game: number; white: string; black: string; date?: string; url?: string; player: Color };
  /** One sentence shown once it is solved: the line and what it achieves. */
  point: string;
  /** One sentence about the move played in the game. */
  inGame: string;
  loss: number;
}

/** A weakness: the mistakes of one kind, counted over the games. */
export interface Weakness {
  key: string;
  way: Way;
  motif: Motif;
  /** "Pieces left hanging" */
  name: string;
  /** What it is and how often, in a sentence. */
  text: string;
  /** What to do about it while playing. */
  advice: string;
  count: number;
  /** Games it happened in. */
  games: number;
  /** Winning chances given away by these mistakes, summed. */
  loss: number;
  phases: Record<GamePhase, number>;
  rushed: number;
  /** The puzzles that train it. */
  puzzles: string[];
}

export interface PuzzleSet {
  v: 1;
  /** When it was made (epoch ms). */
  made: number;
  /** Whose mistakes: the name the games were looked up or filtered by, if any. */
  player?: string;
  /** How many games went in, and how many of the player's moves they held. */
  games: number;
  moves: number;
  slips: Slip[];
  weaknesses: Weakness[];
  /** In training order. */
  puzzles: Puzzle[];
}

/** How a puzzle went: solved at the first try, after a wrong try or a hint, or shown. */
export type Outcome = "first" | "later" | "shown";
