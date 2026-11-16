/**
 * From a reviewed game to the player's mistakes, each one classified (what went wrong and
 * how) and, where the position has one clear answer, turned into a puzzle.
 *
 * A mistake is a Mistake, Miss or Blunder of the player's (the review's own labels). What
 * went wrong is read from the engine's lines, the same way the review explains moves: the
 * material the best line wins, the material the reply to the game's move wins, a mate
 * either way, and the tactic the first move of that line is (lib/reason/ideas.ts).
 *
 * The puzzle is the position before the mistake ("find the move that was there") when
 * one move stands clearly above the rest. A blunder often has no single right move, only
 * a wrong one: then the puzzle is the position after it, played from the opponent's side
 * ("find why it was a mistake"), which trains seeing the same shot before walking into it.
 */
import { PIECE_VALUE, other, type Color } from "../chess/types";
import { features } from "../commentary/features";
import type { EngineLine } from "../engine/client";
import { formatEval } from "../engine/score";
import { boardIdeas, gainWords } from "../reason/ideas";
import { expectedScore, type ClassifiedMove, type PositionAnalysis } from "../review/classify";
import { lineText } from "../review/explain";
import type { ParsedGame } from "../review/pgn";
import type { GameReview } from "../review/review";
import { wasFreeMaterial } from "../review/safety";
import { buildVariation, type VariationMove } from "../variation";
import type { GamePhase, Motif, Puzzle, Slip, Way } from "./types";

/** One move is "the answer" when the next best gives away at least this much in winning chances. */
export const CLEAR_ANSWER = 0.06;
/** A quiet mistake only makes a puzzle when the best move stands out by more than that. */
const CLEAR_QUIET = 0.1;
/** Material that counts as won or lost: more than a pawn. */
const MATERIAL = 2;
const RUSHED_SECONDS = 30;

const TACTIC: Partial<Record<string, Motif>> = { fork: "fork", pin: "pin", skewer: "skewer", defender: "defender", promotion: "promotion" };

const label = (m: { moveNumber: number; color: Color; san: string }) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;

function phaseAt(fen: string, ply: number): GamePhase {
  const p = features(fen).phase;
  return p === "endgame" ? "endgame" : p === "opening" || ply <= 16 ? "opening" : "middlegame";
}

/** The tactic a line's first move is: taking a piece that was simply loose, a fork, a pin, a skewer…, or just "a tactic". */
function motifOfLine(fen: string, first: VariationMove, rest: VariationMove[]): Motif {
  if (first.captured && first.captured !== "p" && wasFreeMaterial(fen, first.to)) return "hanging";
  const ideas = boardIdeas(first, { after: rest, evalAfter: 300, goodMove: true });
  for (const idea of ideas) {
    const m = TACTIC[idea.kind];
    if (m) return m;
  }
  if (first.captured && wasFreeMaterial(fen, first.to)) return "hanging";
  return "tactic";
}

/** How far the best move stands above the next one, in winning chances for the side to move. */
function standsOut(lines: EngineLine[], mover: Color): number {
  if (!lines[0]) return 0;
  if (!lines[1]) return 1;
  return expectedScore(lines[0].eval, mover) - expectedScore(lines[1].eval, mover);
}

/**
 * What a line wins for `side`, piece by piece, counted where the capturing has stopped
 * (two quiet moves after the last capture, or the end of the line). Unlike a count that
 * stops at the first quiet stretch, a line that starts quietly and wins something three
 * moves in is counted too.
 */
export function lineWins(fen: string, pv: string[], side: Color, maxPlies = 10): { mine: string[]; theirs: string[]; swing: number } {
  // One move further than is counted, to know whether the last counted move is answered by a capture.
  const v = buildVariation(fen, pv, maxPlies + 1);
  const mine: string[] = [];
  const theirs: string[] = [];
  let settled = { mine: 0, theirs: 0 };
  let quiet = 0;
  let any = false;
  for (let i = 0; i < Math.min(v.moves.length, maxPlies); i++) {
    const m = v.moves[i];
    if (m.captured) {
      (m.color === side ? mine : theirs).push(m.captured);
      any = true;
      quiet = 0;
    } else quiet++;
    // A settled point: the next move isn't a capture (or there is none).
    if (!v.moves[i + 1]?.captured) settled = { mine: mine.length, theirs: theirs.length };
    if (any && quiet >= 2) break;
  }
  const a = mine.slice(0, settled.mine);
  const b = theirs.slice(0, settled.theirs);
  const sum = (xs: string[]) => xs.reduce((t, x) => t + PIECE_VALUE[x as keyof typeof PIECE_VALUE], 0);
  return { mine: a, theirs: b, swing: sum(a) - sum(b) };
}

function hash(s: string): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return a.toString(36);
}

export interface GameInput {
  game: ParsedGame;
  review: GameReview;
  positions: (PositionAnalysis | null)[];
  /** Whose mistakes to collect. */
  player: Color;
  /** Position of the game in the set. */
  index: number;
  url?: string;
}

/** What one mistake is: how it went wrong and the tactic or kind of slip behind it. */
export function readSlip(c: ClassifiedMove): { way: Way; motif: Motif; gain: number; lost: number } {
  const mover = c.move.color;
  const opp = other(mover);
  const bestV = c.bestLine ? buildVariation(c.move.fenBefore, c.bestLine.pv, 10) : null;
  const replyV = c.replyLine ? buildVariation(c.move.fenAfter, c.replyLine.pv, 10) : null;
  const gain = c.bestLine ? lineWins(c.move.fenBefore, c.bestLine.pv, mover).swing : 0;
  // What the opponent comes out ahead by after the game's move, counted from before it (so a capture that is simply recaptured is level).
  const taken = c.move.captured ? PIECE_VALUE[c.move.captured] : 0;
  const lost = (c.replyLine ? lineWins(c.move.fenAfter, c.replyLine.pv, opp).swing : 0) - taken;
  const matesMe = c.evalAfter.kind === "mate" && c.evalAfter.winner === opp && !(c.evalBefore.kind === "mate" && c.evalBefore.winner === opp);
  const iMate = c.bestLine?.eval.kind === "mate" && c.bestLine.eval.winner === mover && !(c.evalAfter.kind === "mate" && c.evalAfter.winner === mover);
  if (matesMe) return { way: "allowed", motif: "mate", gain, lost };
  if (iMate) return { way: "missed", motif: "mate", gain, lost };
  if (lost >= MATERIAL && replyV?.moves[0]) return { way: "allowed", motif: motifOfLine(c.move.fenAfter, replyV.moves[0], replyV.moves.slice(1)), gain, lost };
  // A tactic was missed when the best line wins that much more than the game's line did.
  if (gain - Math.max(0, -lost) >= MATERIAL && bestV?.moves[0]) return { way: "missed", motif: motifOfLine(c.move.fenBefore, bestV.moves[0], bestV.moves.slice(1)), gain, lost };
  // Nothing won or lost on the spot: a won position let go, or ground given up in the opening, the endgame or between.
  const phase = phaseAt(c.move.fenBefore, c.move.ply);
  const letGo = c.missed?.kind === "win" || (c.before >= 0.75 && c.after < 0.6);
  return { way: "slip", motif: letGo ? "win" : phase === "endgame" ? "endgame" : phase === "opening" ? "opening" : "positional", gain, lost };
}

/** The player's mistakes in one game, and the puzzles that come out of them. */
export function fromGame(inp: GameInput): { slips: Slip[]; puzzles: Puzzle[]; moves: number } {
  const { game, review, positions, player, index } = inp;
  const slips: Slip[] = [];
  const puzzles: Puzzle[] = [];
  const plyOf = new Map<string, number>();
  const mine = review.moves.filter((c) => c.move.color === player);
  for (const c of mine) {
    if (c.cls !== "mistake" && c.cls !== "miss" && c.cls !== "blunder") continue;
    if (!c.bestLine || !c.bestUci) continue;
    const { way, motif, gain, lost } = readSlip(c);
    const mover = c.move.color;
    const opp = other(mover);
    const phase = phaseAt(c.move.fenBefore, c.move.ply);
    const key = `${way}:${motif}`;
    const slip: Slip = { key, way, motif, phase, loss: c.loss, rushed: c.move.clock != null && c.move.clock < RUSHED_SECONDS, game: index, ply: c.move.ply };

    const before = positions[c.move.ply - 1];
    const after = positions[c.move.ply];
    const source = { game: index, white: game.white, black: game.black, date: game.headers.Date, url: inp.url, player };
    const played = { label: label(c.move), uci: c.move.uci, fen: c.move.fenBefore };
    const punishment = c.replyLine?.pv.slice(0, 8) ?? [];
    const replyText = punishment.length ? lineText(c.move.fenAfter, punishment, 3) : "";
    const replyWins = c.replyLine ? lineWins(c.move.fenAfter, c.replyLine.pv, opp) : null;
    const cost = way === "allowed" && motif === "mate" ? "and it is mate" : lost >= MATERIAL && replyWins && replyWins.swing >= 1 ? `losing ${gainWords(replyWins)}` : `and the evaluation went from ${formatEval(c.evalBefore)} to ${formatEval(c.evalAfter)}`;
    const inGame = `In the game: ${played.label}${replyText ? ` ${replyText}` : ""}, ${cost}.`;

    // The answer has to be the answer: one move clearly above the next.
    const clearBefore = !!before && standsOut(before.lines, mover) >= (way === "slip" ? CLEAR_QUIET : CLEAR_ANSWER);
    const clearAfter = !!after && way === "allowed" && !!c.replyLine && standsOut(after.lines, opp) >= CLEAR_ANSWER;
    let puzzle: Puzzle | null = null;
    if (clearAfter && c.replyLine) {
      const pv = c.replyLine.pv.slice(0, 8);
      const what = motif === "mate" ? "and it is mate" : replyWins && replyWins.swing >= 1 ? `winning ${gainWords(replyWins)}` : `and the evaluation is ${formatEval(c.replyLine.eval)}`;
      puzzle = {
        id: hash(`${c.move.fenAfter}|${pv[0]}`),
        key,
        way,
        motif,
        phase,
        fen: c.move.fenAfter,
        solver: opp,
        task: "punish",
        solution: pv,
        eval: c.replyLine.eval,
        played,
        punishment,
        source,
        point: `${lineText(c.move.fenAfter, pv, 5)}, ${what}.`,
        inGame,
        loss: c.loss,
      };
    } else if (clearBefore) {
      const pv = c.bestLine.pv.slice(0, 8);
      const what =
        c.bestLine.eval.kind === "mate" && c.bestLine.eval.winner === mover
          ? "and it is mate"
          : gain >= MATERIAL
            ? `winning ${gainWords(lineWins(c.move.fenBefore, c.bestLine.pv, mover))}`
            : `which keeps it at ${formatEval(c.bestLine.eval)}`;
      puzzle = {
        id: hash(`${c.move.fenBefore}|${pv[0]}`),
        key,
        way,
        motif,
        phase,
        fen: c.move.fenBefore,
        solver: mover,
        task: "better",
        solution: pv,
        eval: c.bestLine.eval,
        played,
        punishment,
        source,
        point: `${lineText(c.move.fenBefore, pv, 5)}, ${what}.`,
        inGame,
        loss: c.loss,
      };
    }
    if (puzzle && !puzzles.some((p) => p.id === puzzle!.id)) {
      // The same move missed again a move or two later is the same lesson: keep the costlier one.
      const twin = puzzles.findIndex((p) => p.task === puzzle!.task && p.solution[0] === puzzle!.solution[0] && Math.abs((plyOf.get(p.id) ?? 0) - c.move.ply) <= 4);
      if (twin < 0) {
        puzzles.push(puzzle);
        plyOf.set(puzzle.id, c.move.ply);
        slip.puzzle = puzzle.id;
      } else if (puzzle.loss > puzzles[twin].loss) {
        for (const s of slips) if (s.puzzle === puzzles[twin].id) s.puzzle = undefined;
        puzzles[twin] = puzzle;
        plyOf.set(puzzle.id, c.move.ply);
        slip.puzzle = puzzle.id;
      }
    }
    slips.push(slip);
  }
  return { slips, puzzles, moves: mine.length };
}

/** Which side a named player has in a game, or null when the name is neither player's. */
export function sideOf(game: ParsedGame, name: string): Color | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (game.white.trim().toLowerCase() === n) return "w";
  if (game.black.trim().toLowerCase() === n) return "b";
  return null;
}

/** The name that plays in the most games of a set: who the set is most likely about. */
export function commonPlayer(games: ParsedGame[]): string | null {
  const count = new Map<string, { name: string; n: number }>();
  for (const g of games)
    for (const name of [g.white, g.black]) {
      const k = name.trim().toLowerCase();
      if (!k || k === "?" || k === "white" || k === "black") continue;
      const cur = count.get(k) ?? { name: name.trim(), n: 0 };
      cur.n++;
      count.set(k, cur);
    }
  const best = [...count.values()].sort((a, b) => b.n - a.n)[0];
  return best && (games.length === 1 || best.n > 1) ? best.name : null;
}
