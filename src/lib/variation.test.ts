import { describe, expect, it } from "vitest";
import { START_FEN } from "./chess/fen";
import { buildVariation, fenAtPly, formatLine, moveAtPly, navigate, uciToSan } from "./variation";

describe("buildVariation", () => {
  it("converts UCI to SAN with a FEN at each ply", () => {
    const v = buildVariation(START_FEN, ["e2e4", "e7e5", "g1f3"]);
    expect(v.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(v.truncated).toBe(false);
    expect(v.moves[2].fenBefore).toBe(v.moves[1].fenAfter);
    expect(v.moves[2].moveNumber).toBe(2);
  });

  it("stops at the first illegal move instead of showing it", () => {
    const v = buildVariation(START_FEN, ["e2e4", "e2e4", "g1f3"]);
    expect(v.moves).toHaveLength(1);
    expect(v.truncated).toBe(true);
  });

  it("handles promotions, castling and checks", () => {
    const promo = buildVariation("8/P6k/8/8/8/8/8/K7 w - - 0 1", ["a7a8q"]);
    expect(promo.moves[0].san).toBe("a8=Q");
    const castle = buildVariation("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", ["e1g1"]);
    expect(castle.moves[0].isCastle).toBe(true);
    const check = buildVariation("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", ["a1a8"]);
    expect(check.moves[0].isCheck).toBe(true);
    expect(uciToSan(START_FEN, "e2e5")).toBeNull();
  });
});

describe("variation navigation", () => {
  const v = buildVariation(START_FEN, ["d2d4", "d7d5", "c2c4"]);

  it("steps and clamps within the line", () => {
    expect(navigate(v, 0, "prev")).toBe(0);
    expect(navigate(v, 0, "next")).toBe(1);
    expect(navigate(v, 3, "next")).toBe(3);
    expect(navigate(v, 2, "first")).toBe(0);
    expect(navigate(v, 0, "last")).toBe(3);
    expect(navigate(v, 1, { goto: 99 })).toBe(3);
    expect(navigate(v, 1, { goto: -4 })).toBe(0);
  });

  it("returns the board and move for each ply", () => {
    expect(fenAtPly(v, 0)).toBe(START_FEN);
    expect(fenAtPly(v, 3)).toBe(v.moves[2].fenAfter);
    expect(moveAtPly(v, 0)).toBeNull();
    expect(moveAtPly(v, 2)?.san).toBe("d5");
  });

  it("formats move numbers, including a line that starts with Black", () => {
    expect(formatLine(v).map((t) => t.label)).toEqual(["1.d4", "d5", "2.c4"]);
    const black = buildVariation("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", ["c7c5", "g1f3"]);
    expect(formatLine(black).map((t) => t.label)).toEqual(["1…c5", "2.Nf3"]);
  });
});
