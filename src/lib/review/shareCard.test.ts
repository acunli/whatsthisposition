import { describe, expect, it } from "vitest";
import type { ClassifiedMove, MoveClass } from "./classify";
import { OPERA_GAME } from "./fixtures/games";
import { gamePgn, parseGame } from "./pgn";
import { describe as describeShare, headline, readSummary, summarize } from "./shareCard";

const game = parseGame(OPERA_GAME);
/** Labels by ply (1-based); every other move is Good. */
const labelled = (labels: Record<number, MoveClass>) => game.moves.map((move) => ({ move, cls: labels[move.ply] ?? "good" }) as ClassifiedMove);

describe("a game written back as PGN", () => {
  it("parses to the same game", () => {
    const again = parseGame(gamePgn(game));
    expect(again.moves.map((m) => m.san)).toEqual(game.moves.map((m) => m.san));
    expect([again.white, again.black, again.result]).toEqual([game.white, game.black, game.result]);
  });

  it("keeps a start position, a Black first move, clocks and quotes in names", () => {
    const g = parseGame('[White "A \\"Ace\\" B"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"]\n\n1... Kd7 {[%clk 0:02:59.5]} 2. e4 {[%clk 0:03:00]} *');
    const again = parseGame(gamePgn(g));
    expect(again.startFen).toBe(g.startFen);
    expect(again.moves.map((m) => [m.san, m.clock])).toEqual([["Kd7", 179.5], ["e4", 180]]);
    expect(again.white).toBe('A "Ace" B');
  });
});

describe("a shared review's summary", () => {
  it("names the sharer's first Brilliant, else their first Great move", () => {
    const s = summarize(game, labelled({ 21: "great", 31: "brilliant", 32: "blunder" }), { w: 92.14, b: 40 }, "w");
    expect(s.moment).toMatchObject({ name: "16.Qb8+", cls: "brilliant", color: "w", from: "b3", to: "b8" });
    expect(s.counts.w).toEqual({ great: 1, brilliant: 1 });
    expect(s.counts.b).toEqual({ blunder: 1 });
    expect(summarize(game, labelled({ 21: "great" }), null, "w").moment?.name).toBe("11.Bxb5+");
    expect(summarize(game, labelled({ 21: "great" }), null, "b").moment).toBeUndefined();
  });

  it("reads as a title and a description", () => {
    const s = summarize(game, labelled({ 31: "brilliant" }), { w: 92.14, b: 40 }, "w");
    expect(headline(s)).toBe("16.Qb8+, a Brilliant move");
    expect(describeShare(s)).toContain("Paul Morphy 92.1");
    expect(headline({ ...s, moment: undefined })).toBe("92.1 accuracy");
  });

  it("survives the server's checks unchanged", () => {
    const s = summarize(game, labelled({ 31: "brilliant", 2: "mistake" }), { w: 92.1, b: 40 }, "w");
    expect(readSummary(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("drops or refuses what a page shouldn't show", () => {
    const s = summarize(game, labelled({ 31: "brilliant" }), { w: 92.1, b: 40 }, "w");
    expect(readSummary({ ...s, as: "x" })).toBeNull();
    expect(readSummary({ ...s, finalFen: "<script>" })).toBeNull();
    const odd = readSummary({ ...s, white: "x".repeat(200), whiteElo: "9999999", accuracy: { w: 500, b: "40" }, counts: { w: { blunder: -1, brilliant: 2, ok: 9 } }, moment: { ...s.moment, from: "z9" } })!;
    expect(odd.white).toHaveLength(40);
    expect(odd.whiteElo).toBeUndefined();
    expect(odd.accuracy).toEqual({ w: null, b: null });
    expect(odd.counts).toEqual({ w: { brilliant: 2 }, b: {} });
    expect(odd.moment).toBeUndefined();
  });
});
