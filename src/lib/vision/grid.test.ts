import { describe, expect, it } from "vitest";
import { gridToPlacement, recognitionSchema, type Recognition } from "./grid";

const emptyRows = (): Recognition["rows"] =>
  Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ piece: "" as const, confident: true })));

describe("gridToPlacement", () => {
  const rows = emptyRows();
  rows[7][0] = { piece: "R", confident: true }; // bottom-left in the photo
  rows[0][4] = { piece: "k", confident: false }; // top edge, fifth from left

  it("maps the photo to squares when White is at the bottom", () => {
    const { placement, uncertain } = gridToPlacement(rows, true);
    expect(placement.a1).toEqual({ color: "w", type: "r" });
    expect(placement.e8).toEqual({ color: "b", type: "k" });
    expect(uncertain).toEqual(["e8"]);
  });

  it("maps the photo to squares when Black is at the bottom", () => {
    const { placement, uncertain } = gridToPlacement(rows, false);
    expect(placement.h8).toEqual({ color: "w", type: "r" });
    expect(placement.d1).toEqual({ color: "b", type: "k" });
    expect(uncertain).toEqual(["d1"]);
  });
});

describe("recognitionSchema", () => {
  it("rejects anything that isn't a full 8×8 grid of known pieces", () => {
    expect(recognitionSchema.safeParse({ board_found: true, notes: "", rows: emptyRows() }).success).toBe(true);
    expect(recognitionSchema.safeParse({ board_found: true, notes: "", rows: emptyRows().slice(0, 7) }).success).toBe(false);
    const bad = emptyRows();
    (bad[0][0] as { piece: string }).piece = "X";
    expect(recognitionSchema.safeParse({ board_found: true, notes: "", rows: bad }).success).toBe(false);
  });
});
