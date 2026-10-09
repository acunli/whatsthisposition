import { describe, expect, it } from "vitest";
import type { PositionAnalysis } from "./classify";
import { packReview, readReviewHash, reviewLink, unpackReview } from "./share";

const pos = (cp: number, pv: string[]): PositionAnalysis => ({
  depth: 18,
  eval: { kind: "cp", cp },
  lines: [
    { multipv: 1, depth: 18, eval: { kind: "cp", cp }, pv },
    { multipv: 2, depth: 18, eval: { kind: "cp", cp: cp - 40 }, pv: pv.slice(0, 3) },
  ],
});

describe("a finished review carried in the link", () => {
  it("comes back exactly as it went in", async () => {
    const positions: (PositionAnalysis | null)[] = [
      pos(20, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]),
      { depth: 22, eval: { kind: "mate", moves: 3, winner: "w" }, lines: [{ multipv: 1, depth: 22, eval: { kind: "mate", moves: 3, winner: "w" }, pv: ["d1h5", "g7g6", "h5f7"] }] },
      { depth: 0, eval: { kind: "mate", moves: 0, winner: "b" }, lines: [] },
      null,
      pos(-35, ["a7a8q", "b2b1n"]),
      // A sacrifice's quiet alternative travels too, so the site labels the move as the extension did.
      { ...pos(32, ["d5e6", "f7e6"]), quiet: { multipv: 1, depth: 22, eval: { kind: "cp", cp: -6 }, pv: ["c4b5", "c7c6"] } },
    ];
    const data = await packReview(positions, 18);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await unpackReview(data)).toEqual({ depth: 18, positions });
    const link = reviewLink("https://whatsthisposition.vercel.app", '[White "a"]\n\n1. e4 *', "w", 18, data);
    expect(readReviewHash(new URL(link).hash)?.data).toBe(data);
  });

  it("stays small for a whole game", async () => {
    const pv = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7", "f1e1", "b7b5", "a4b3", "d7d6"];
    const data = await packReview(Array.from({ length: 81 }, (_, i) => pos(i * 3 - 100, pv)), 18);
    expect(data.length).toBeLessThan(20000);
  });

  it("rejects anything that isn't a packed review", async () => {
    expect(await unpackReview("not-base64!!")).toBeNull();
    const bad = await packReview([pos(10, ["e2e4"])], 18);
    expect(await unpackReview(bad.slice(0, -6))).toBeNull();
    // A line with something other than UCI moves in it.
    const evil = await packReview([{ depth: 1, eval: { kind: "cp", cp: 0 }, lines: [{ multipv: 1, depth: 1, eval: { kind: "cp", cp: 0 }, pv: ["<script>"] }] }], 1);
    expect(await unpackReview(evil)).toBeNull();
  });
});
