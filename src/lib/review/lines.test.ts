import { describe, expect, it } from "vitest";
import openings from "@/data/openings.json";
import type { Evaluation } from "../engine/score";
import { makeBook } from "./book";
import type { PositionAnalysis } from "./classify";
import { movesFrom, placeMove, placeMoves, selectionFen, stepSelection, type SideLine } from "./lines";
import { parseGame } from "./pgn";
import { classifyGame, classifyLine, lineChecks } from "./review";

const game = parseGame("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
const cp = (n: number): Evaluation => ({ kind: "cp", cp: n });
const pa = (e: Evaluation, pv: string[], depth = 14, second?: Evaluation): PositionAnalysis => ({
  eval: e,
  depth,
  lines: [{ multipv: 1, depth, eval: e, pv }, ...(second ? [{ multipv: 2, depth, eval: second, pv: ["a2a3"] }] : [])],
});

describe("side lines: where a move played on the board goes", () => {
  it("follows the game when the game's move is played", () => {
    expect(placeMove(game, [], { line: null, ply: 0 }, "e2e4", 1)).toEqual({ lines: [], sel: { line: null, ply: 1 } });
  });

  it("starts a line, extends it at its end, and steps into it when the same move is played again", () => {
    const a = placeMove(game, [], { line: null, ply: 0 }, "d2d4", 1)!;
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0]).toMatchObject({ id: 1, from: 0 });
    expect(a.sel).toEqual({ line: 1, ply: 1 });
    const b = placeMove(game, a.lines, a.sel, "g8f6", 2)!;
    expect(b.lines[0].moves.map((m) => m.san)).toEqual(["d4", "Nf6"]);
    expect(b.sel).toEqual({ line: 1, ply: 2 });
    // From the game again: the same first move steps into the line instead of making another.
    const c = placeMove(game, b.lines, { line: null, ply: 0 }, "d2d4", 2)!;
    expect(c.lines).toBe(b.lines);
    expect(c.sel).toEqual({ line: 1, ply: 1 });
    // A different move inside the line starts a sibling that shares the moves before it.
    const d = placeMove(game, b.lines, { line: 1, ply: 1 }, "d7d5", 2)!;
    expect(d.lines).toHaveLength(2);
    expect(d.lines[1]).toMatchObject({ id: 2, from: 0 });
    expect(d.lines[1].moves.map((m) => m.san)).toEqual(["d4", "d5"]);
    expect(d.lines[0].moves.map((m) => m.san)).toEqual(["d4", "Nf6"]);
    // And playing the line's own next move just walks along it.
    expect(placeMove(game, b.lines, { line: 1, ply: 1 }, "g8f6", 3)?.sel).toEqual({ line: 1, ply: 2 });
  });

  it("numbers a line's moves as the game would", () => {
    // Instead of 2…Nc6 (after 1.e4 e5 2.Nf3): 2…d6 3.d4.
    const r = placeMoves(game, [], { line: null, ply: 3 }, ["d7d6", "d2d4"], 1)!;
    const [m1, m2] = r.lines[0].moves;
    expect(m1).toMatchObject({ san: "d6", ply: 4, moveNumber: 2, color: "b" });
    expect(m2).toMatchObject({ san: "d4", ply: 5, moveNumber: 3, color: "w" });
    expect(r.nextId).toBe(2);
    expect(selectionFen(game, r.lines, r.sel)).toBe(m2.fenAfter);
    expect(selectionFen(game, r.lines, { line: null, ply: 3 })).toBe(game.moves[2].fenAfter);
  });

  it("continues a previewed line from the game: game moves are followed, the first other move starts the line", () => {
    const r = placeMoves(game, [], { line: null, ply: 0 }, ["e2e4", "c7c5", "g1f3"], 1)!;
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].from).toBe(1);
    expect(r.lines[0].moves.map((m) => m.san)).toEqual(["c5", "Nf3"]);
    expect(r.sel).toEqual({ line: 1, ply: 2 });
  });

  it("steps through a line and back out to the game", () => {
    const lines: SideLine[] = [{ id: 1, from: 2, moves: movesFrom(game.moves[1].fenAfter, ["f1c4", "g8f6"], 2)! }];
    expect(stepSelection(game, lines, { line: 1, ply: 1 }, 1)).toEqual({ line: 1, ply: 2 });
    expect(stepSelection(game, lines, { line: 1, ply: 2 }, 1)).toEqual({ line: 1, ply: 2 });
    expect(stepSelection(game, lines, { line: 1, ply: 1 }, -1)).toEqual({ line: null, ply: 2 });
    expect(stepSelection(game, lines, { line: null, ply: 6 }, 1)).toEqual({ line: null, ply: 6 });
  });

  it("refuses an illegal move", () => {
    expect(placeMove(game, [], { line: null, ply: 0 }, "e2e5", 1)).toBeNull();
  });
});

describe("side lines: labels", () => {
  // The game, analysed: level until the end.
  const positions = [pa(cp(30), ["e2e4"]), pa(cp(30), ["e7e5"]), pa(cp(30), ["g1f3"], 14, cp(20)), pa(cp(25), ["b8c6"]), pa(cp(30), ["f1b5"]), pa(cp(30), ["a7a6"]), pa(cp(30), ["b5a4"])];
  const line: SideLine = { id: 1, from: 2, moves: movesFrom(game.moves[1].fenAfter, ["d2d4"], 2)! }; // instead of 2.Nf3

  it("labels a line's moves with the game's rules, after the game move it branches from", () => {
    const base = classifyGame(game, positions, null);
    const after = pa(cp(-150), ["e5d4"]);
    const labels = classifyLine(game, line, (k) => (k === 0 ? positions[2] : after), null, base);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ cls: "mistake" });
    expect(labels[0].move).toMatchObject({ san: "d4", ply: 3 });
    // Nothing is labelled until the line's position has been analysed.
    expect(classifyLine(game, line, (k) => (k === 0 ? positions[2] : null), null, base)).toEqual([]);
  });

  it("keeps the opening book going when the game was still in book where the line starts", () => {
    const book = makeBook(openings as { book: string[]; names: Record<string, string> });
    const base = classifyGame(game, positions, book);
    expect(base.bookUntil).toBeGreaterThanOrEqual(1);
    // 1.e4 e5 2.d4 is the Center Game.
    const labels = classifyLine(game, line, (k) => (k === 0 ? positions[2] : pa(cp(10), ["e5d4"])), book, base);
    expect(labels[0].cls).toBe("book");
  });

  it("asks for a deeper look around a line's tactical labels, as the game's second pass does", () => {
    const base = classifyGame(game, positions, null);
    const after = pa(cp(-400), ["e5d4"]);
    const at = (k: number) => (k === 0 ? positions[2] : after);
    const labels = classifyLine(game, line, at, null, base);
    expect(labels[0].cls).toBe("blunder");
    expect(lineChecks(game, line, labels, at, base, 18).deeper).toEqual([0, 1]);
    expect(lineChecks(game, line, labels, at, base, 14).deeper).toEqual([]);
  });
});
