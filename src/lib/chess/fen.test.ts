import { describe, expect, it } from "vitest";
import {
  EMPTY_CASTLING,
  START_FEN,
  parseFen,
  possibleCastling,
  possibleEpSquares,
  setupFromFen,
  setupToFen,
  validateSetup,
  gameStatus,
} from "./fen";
import type { PositionSetup } from "./types";

const codes = (fen: string, patch: Partial<PositionSetup> = {}) =>
  validateSetup({ ...setupFromFen(fen), ...patch }).map((i) => i.code);

describe("parseFen", () => {
  it("round-trips the starting position", () => {
    const r = parseFen(START_FEN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(setupToFen(r.setup)).toBe(START_FEN);
  });

  it("fills in missing clocks but requires the side to move", () => {
    const r = parseFen("8/8/8/4k3/8/8/8/4K3 b");
    expect(r.ok && setupToFen(r.setup)).toBe("8/8/8/4k3/8/8/8/4K3 b - - 0 1");
    const missing = parseFen("8/8/8/4k3/8/8/8/4K3");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues[0].code).toBe("fen-turn");
  });

  it("rejects malformed boards with a readable reason", () => {
    for (const bad of ["8/8/8 w - - 0 1", "9/8/8/8/8/8/8/8 w - - 0 1", "rnbqkbnr/ppppxppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]) {
      const r = parseFen(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].message.length).toBeGreaterThan(10);
    }
  });

  it("rejects bad castling and en passant fields", () => {
    expect(parseFen("4k3/8/8/8/8/8/8/4K3 w KK - 0 1").ok).toBe(false);
    expect(parseFen("4k3/8/8/8/8/8/8/4K3 w - e4 0 1").ok).toBe(false);
  });
});

describe("validateSetup", () => {
  it("accepts legal positions", () => {
    expect(codes(START_FEN)).toEqual([]);
    expect(codes("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1")).toEqual([]);
  });

  it("requires the player to choose whose turn it is", () => {
    expect(codes(START_FEN, { turn: null })).toContain("turn-missing");
  });

  it("flags missing and extra kings", () => {
    expect(codes("8/8/8/8/8/8/8/4K3 w - - 0 1")).toContain("king-missing-b");
    expect(codes("4k3/8/8/8/8/8/8/K3K3 w - - 0 1")).toContain("king-extra-w");
  });

  it("flags pawns on the back ranks with their squares", () => {
    const issues = validateSetup(setupFromFen("P3k3/8/8/8/8/8/8/4K3 w - - 0 1"));
    const i = issues.find((x) => x.code === "pawn-back-rank");
    expect(i?.squares).toEqual(["a8"]);
  });

  it("flags the side not to move being in check", () => {
    // Black king on e8 is attacked by the rook on e1... but it's White's move.
    expect(codes("4k3/8/8/8/8/8/8/K3R3 w - - 0 1")).toContain("wrong-side-in-check");
    expect(codes("4k3/8/8/8/8/8/8/K3R3 b - - 0 1")).not.toContain("wrong-side-in-check");
  });

  it("flags adjacent kings", () => {
    expect(codes("8/8/8/3kK3/8/8/8/8 w - - 0 1")).toContain("kings-adjacent");
  });

  it("flags castling rights the pieces don't allow", () => {
    expect(codes("4k3/8/8/8/8/8/8/4K2R w K - 0 1")).toEqual([]);
    expect(codes("4k3/8/8/8/8/8/8/4K3 w K - 0 1")).toContain("castling-impossible");
    expect(possibleCastling(setupFromFen(START_FEN).placement)).toEqual({ K: true, Q: true, k: true, q: true });
    expect(possibleCastling(setupFromFen("4k3/8/8/8/8/8/8/R3K3 w - - 0 1").placement)).toEqual({ ...EMPTY_CASTLING, Q: true });
  });

  it("only accepts en passant squares behind a pawn that just double-pushed", () => {
    const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    expect(codes(fen)).toEqual([]);
    expect(possibleEpSquares(setupFromFen(fen).placement, "w")).toEqual(["d6"]);
    expect(codes("4k3/8/8/4P3/8/8/8/4K3 w - d6 0 1")).toContain("ep-impossible");
    expect(codes(fen, { turn: "b" })).toContain("ep-impossible");
  });

  it("flags impossible promotion counts", () => {
    expect(codes("4k3/8/8/8/8/8/PPPPPPPP/QQQK4 w - - 0 1")).toContain("promotions-w");
  });
});

describe("gameStatus", () => {
  it("recognizes checkmate and stalemate", () => {
    expect(gameStatus("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1").kind).toBe("checkmate");
    expect(gameStatus("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").kind).toBe("stalemate");
    expect(gameStatus(START_FEN).kind).toBe("ongoing");
  });
});
