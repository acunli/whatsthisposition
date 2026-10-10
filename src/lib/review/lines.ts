/**
 * Side lines in a game review: moves the player tries on the board instead of the game's.
 * Each line starts at a game position and is analysed and labelled like the game itself
 * (review.ts, classifyLine), then shown as a branch in the move list.
 */
import { Chess } from "chess.js";
import type { ParsedGame, GameMove } from "./pgn";

export interface SideLine {
  id: number;
  /** The game position it starts from (after `from` game moves): its first move is played instead of game move `from + 1`. */
  from: number;
  moves: GameMove[];
}

/** Where the board is: a game position (`line` null, `ply` game moves played) or a side line (`ply` of its moves played, 1…length). */
export interface LineSelection {
  line: number | null;
  ply: number;
}

/** Moves for `ucis` played from `fen`, numbered as if they continued a game after `startPly` half-moves. Null if one is illegal. */
export function movesFrom(fen: string, ucis: string[], startPly: number): GameMove[] | null {
  const chess = new Chess(fen);
  const out: GameMove[] = [];
  for (const [k, uci] of ucis.entries()) {
    const before = chess.fen();
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return null;
    }
    out.push({
      ply: startPly + k + 1,
      san: m.san,
      uci: m.lan,
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      fenBefore: before,
      fenAfter: m.after,
      moveNumber: Number(before.split(" ")[5]),
      isCheck: m.san.includes("+") || m.san.includes("#"),
      isMate: m.san.includes("#"),
    });
  }
  return out;
}

/** The position a selection shows. */
export function selectionFen(game: ParsedGame, lines: SideLine[], sel: LineSelection): string {
  const l = sel.line === null ? null : lines.find((x) => x.id === sel.line);
  if (l && sel.ply > 0) return l.moves[sel.ply - 1].fenAfter;
  const p = l ? l.from : sel.ply;
  return p > 0 ? game.moves[p - 1].fenAfter : game.startFen;
}

/**
 * A move played on the board. The game's own move follows the game; a move a side line already
 * has steps into it; at the end of a line it extends the line; anything else starts a line (from
 * the same game position, sharing the moves before it when it leaves another line).
 */
export function placeMove(game: ParsedGame, lines: SideLine[], sel: LineSelection, uci: string, nextId: number): { lines: SideLine[]; sel: LineSelection } | null {
  const current = sel.line === null ? null : (lines.find((x) => x.id === sel.line) ?? null);
  const from = current ? current.from : sel.ply;
  const prefix = current ? current.moves.slice(0, sel.ply).map((m) => m.uci) : [];
  if (!current && game.moves[from]?.uci === uci) return { lines, sel: { line: null, ply: from + 1 } };
  if (current && current.moves[sel.ply]?.uci === uci) return { lines, sel: { line: current.id, ply: sel.ply + 1 } };
  const want = [...prefix, uci];
  const same = lines.find((l) => l.from === from && l.moves.length >= want.length && want.every((u, i) => l.moves[i].uci === u));
  if (same) return { lines, sel: { line: same.id, ply: want.length } };
  const fen = from > 0 ? game.moves[from - 1].fenAfter : game.startFen;
  if (current && sel.ply === current.moves.length) {
    const added = movesFrom(current.moves[current.moves.length - 1]?.fenAfter ?? fen, [uci], from + sel.ply);
    if (!added) return null;
    const grown = { ...current, moves: [...current.moves, ...added] };
    return { lines: lines.map((l) => (l.id === current.id ? grown : l)), sel: { line: current.id, ply: grown.moves.length } };
  }
  const moves = movesFrom(fen, want, from);
  if (!moves) return null;
  return { lines: [...lines, { id: nextId, from, moves }], sel: { line: nextId, ply: moves.length } };
}

/** Several moves in a row (`placeMove` for each), e.g. an engine line the player continues from. */
export function placeMoves(game: ParsedGame, lines: SideLine[], sel: LineSelection, ucis: string[], nextId: number): { lines: SideLine[]; sel: LineSelection; nextId: number } | null {
  let cur = { lines, sel, nextId };
  for (const uci of ucis) {
    const r = placeMove(game, cur.lines, cur.sel, uci, cur.nextId);
    if (!r) return null;
    cur = { lines: r.lines, sel: r.sel, nextId: r.lines.some((l) => l.id === cur.nextId) ? cur.nextId + 1 : cur.nextId };
  }
  return cur;
}

/** One step through the moves from a selection: inside a line, or along the game. */
export function stepSelection(game: ParsedGame, lines: SideLine[], sel: LineSelection, dir: 1 | -1): LineSelection {
  const l = sel.line === null ? null : lines.find((x) => x.id === sel.line);
  if (!l) return { line: null, ply: Math.max(0, Math.min(game.moves.length, sel.ply + dir)) };
  const p = sel.ply + dir;
  if (p <= 0) return { line: null, ply: l.from };
  return { line: l.id, ply: Math.min(l.moves.length, p) };
}

/** A key for a position that ignores the move counters, so transpositions share an analysis. */
export const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
