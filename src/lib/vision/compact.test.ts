import { describe, expect, it } from "vitest";
import { compactToRecognition, extractJson, normaliseRow } from "./compact";
import { gridToPlacement } from "./grid";

describe("compact vision replies", () => {
  it("extracts JSON from fenced replies with Qwen think blocks", () => {
    const reply = '<think>let me look</think>\n```json\n{"board_found": true, "rows": [], "unsure": []}\n```';
    expect(extractJson(reply)).toEqual({ board_found: true, rows: [], unsure: [] });
  });

  it("accepts dotted rows, FEN digits and spaced rows", () => {
    expect(normaliseRow("r1bqkbnr")).toBe("r.bqkbnr");
    expect(normaliseRow("r . b q k b n r")).toBe("r.bqkbnr");
  });

  it("maps rows and unsure cells onto the board", () => {
    const rec = compactToRecognition({
      board_found: true,
      rows: ["rnbqkbnr", "pppppppp", "8", "8", "4P3", "8", "PPPP1PPP", "RNBQKBNR"],
      unsure: [[4, 4], "0,4"],
    });
    const { placement, uncertain } = gridToPlacement(rec.rows, true);
    expect(placement.e4).toEqual({ color: "w", type: "p" });
    expect(placement.e8).toEqual({ color: "b", type: "k" });
    expect(uncertain.sort()).toEqual(["e4", "e8"]);
  });

  it("accepts a single FEN board field", () => {
    const rec = compactToRecognition({ board_found: true, rows: ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"] });
    expect(rec.rows[7][4].piece).toBe("K");
  });

  it("rejects boards that aren't 8×8 with a reason", () => {
    expect(() => compactToRecognition({ board_found: true, rows: ["rnbqkbnr"] })).toThrow(/8 rows/);
    expect(() => compactToRecognition({ board_found: true, rows: Array(8).fill("rnbqkbn") })).toThrow(/7 squares/);
    expect(() => compactToRecognition({ board_found: true, rows: Array(8).fill("rnbqkbnx") })).toThrow(/unknown piece/);
  });

  it("passes through 'no board' with the model's note", () => {
    const rec = compactToRecognition({ board_found: false, rows: [], notes: "Too blurry." });
    expect(rec.board_found).toBe(false);
    expect(rec.notes).toBe("Too blurry.");
  });
});
