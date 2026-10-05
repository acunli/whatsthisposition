import { describe, expect, it } from "vitest";
import openings from "@/data/openings.json";
import { START_FEN } from "../chess/fen";
import type { Evaluation } from "../engine/score";
import { gameAccuracy } from "./accuracy";
import { makeBook } from "./book";
import { classifyMove, expectedScore, moveAccuracy, type ClassifiedMove, type PositionAnalysis } from "./classify";
import { GAME_OF_THE_CENTURY, OPERA_GAME, SHILLING_TRAP } from "./fixtures/games";
import { mainLineTokens, parseFirstGame, parseGame, splitGames } from "./pgn";
import { analysePositions, classifyGame, criticalPositions } from "./review";
import { KASPAROV_TOPALOV } from "./samples";
import { detectSacrifice, see, unsafePieces } from "./safety";
import { placementFromFen } from "../chess/fen";

const book = makeBook(openings as { book: string[]; names: Record<string, string> });
const cp = (n: number): Evaluation => ({ kind: "cp", cp: n });
const pa = (e: Evaluation, pv: string[] = [], second?: Evaluation): PositionAnalysis => ({
  eval: e,
  depth: 14,
  lines: [{ multipv: 1, depth: 14, eval: e, pv }, ...(second ? [{ multipv: 2, depth: 14, eval: second, pv: ["a2a3"] }] : [])],
});
const moveAt = (pgn: string, ply: number) => parseGame(pgn).moves[ply - 1];

describe("PGN parsing", () => {
  it("parses headers, moves and results", () => {
    const g = parseGame(OPERA_GAME);
    expect(g.white).toBe("Paul Morphy");
    expect(g.moves).toHaveLength(33);
    expect(g.moves[32].san).toBe("Rd8#");
    expect(g.moves[32].isMate).toBe(true);
    expect(g.result).toBe("1-0");
  });

  it("drops variations, NAGs and comments but keeps clocks", () => {
    const { sans, clocks } = mainLineTokens('1. e4 { [%clk 0:02:59] } e5!? (1... c5 2. Nf3 (2. c3)) 2. Nf3 $1 Nc6 { [%clk 0:02:58.5] } *');
    expect(sans).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(clocks[0]).toBe(179);
    expect(clocks[3]).toBe(178.5);
  });

  it("accepts bare move lists, multi-game files and reports the first illegal move", () => {
    expect(parseFirstGame("1. d4 d5 2. c4").moves.map((m) => m.san)).toEqual(["d4", "d5", "c4"]);
    expect(splitGames(`${OPERA_GAME}\n\n${GAME_OF_THE_CENTURY}`)).toHaveLength(2);
    expect(() => parseGame("1. e4 e5 2. Ke3")).toThrow(/2\.Ke3 isn't legal/);
  });

  it("starts from a FEN header", () => {
    const g = parseGame('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7 *');
    expect(g.startFen).toBe("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
    expect(g.moves).toHaveLength(2);
  });
});

describe("opening book", () => {
  it("knows common openings, recognises transpositions, and names them", () => {
    const g = parseGame("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
    expect(g.moves.every((m) => book.inBook(m.fenAfter))).toBe(true);
    expect(book.name(g.moves[4].fenAfter)?.name).toMatch(/Ruy Lopez/);
    expect(book.inBook(START_FEN)).toBe(false);
    expect(book.inBook(parseGame("1. a4 h5 2. Ra3 Rh6 3. Rg3 Rg6 *").moves[5].fenAfter)).toBe(false);
  });
});

describe("piece safety and sacrifices (no engine)", () => {
  it("evaluates exchanges with x-rays", () => {
    // Knight on e5 attacked by a pawn: losing.
    expect(see(placementFromFen("4k3/8/3p4/4N3/8/8/8/4K3 b - - 0 1"), "e5", "b")).toBe(3);
    // Rook takes a pawn defended by a pawn: bad for the taker.
    expect(see(placementFromFen("4k3/8/3p4/4p3/8/8/8/4RK2 w - - 0 1"), "e5", "w")).toBe(0);
    // Battery: two rooks against one defender win the pawn.
    expect(see(placementFromFen("4r1k1/8/8/4p3/8/8/4R3/4RK2 w - - 0 1"), "e5", "w")).toBe(1);
  });

  it("finds Morphy's 16.Qb8+ queen sacrifice and 10.Nxb5 knight sacrifice", () => {
    const qb8 = moveAt(OPERA_GAME, 31);
    expect(qb8.san).toBe("Qb8+");
    expect(detectSacrifice(qb8.fenBefore, qb8.uci)?.pieces.map((p) => p.type)).toEqual(["q"]);
    const nxb5 = moveAt(OPERA_GAME, 19);
    expect(nxb5.san).toBe("Nxb5");
    expect(detectSacrifice(nxb5.fenBefore, nxb5.uci)?.pieces.map((p) => p.square)).toEqual(["b5"]);
  });

  it("finds Fischer's 17...Be6, leaving the queen en prise", () => {
    const be6 = moveAt(GAME_OF_THE_CENTURY, 34);
    expect(be6.san).toBe("Be6");
    expect(detectSacrifice(be6.fenBefore, be6.uci)?.pieces.map((p) => p.type)).toContain("q");
  });

  it("doesn't call trades, rescues or quiet moves sacrifices", () => {
    // 4.dxe5 is a pawn trade.
    expect(detectSacrifice(moveAt(OPERA_GAME, 7).fenBefore, moveAt(OPERA_GAME, 7).uci)).toBeNull();
    // 1.e4 gives nothing away.
    expect(detectSacrifice(START_FEN, "e2e4")).toBeNull();
    // Moving an attacked knight to safety.
    expect(detectSacrifice("4k3/8/3p4/4N3/8/8/8/4K3 w - - 0 1", "e5f3")).toBeNull();
  });

  it("doesn't count a piece the opponent already declined to take as a new sacrifice", () => {
    const g = parseGame(KASPAROV_TOPALOV);
    const bb7 = g.moves[57];
    expect(bb7.san).toBe("Bb7");
    // After 28...Qxd5 the knight on f6 was already loose; 29.Ra7 declined it.
    const declined = unsafePieces(g.moves[56].fenBefore, "b");
    expect(declined.map((p) => p.square)).toContain("f6");
    expect(detectSacrifice(bb7.fenBefore, bb7.uci)?.pieces.map((p) => p.square)).toEqual(["f6"]);
    expect(detectSacrifice(bb7.fenBefore, bb7.uci, declined)).toBeNull();
  });

  it("lists unsafe pieces", () => {
    expect(unsafePieces("4k3/8/3p4/4N3/8/8/8/4K3 b - - 0 1", "w").map((p) => p.square)).toEqual(["e5"]);
  });
});

describe("classification rules (synthetic evaluations)", () => {
  const e4 = moveAt("1. e4", 1);
  const nf3 = moveAt("1. Nf3", 1);
  const base = { legalMoves: 20, inBook: false };

  it("labels by expected-score loss", () => {
    const c = (after: number, played = nf3) => classifyMove({ ...base, move: played, before: pa(cp(30), ["e2e4"]), after: pa(cp(after)) }).cls;
    expect(c(30, e4)).toBe("best");
    expect(c(20)).toBe("excellent");
    expect(c(-20)).toBe("good");
    expect(c(-60)).toBe("inaccuracy");
    expect(c(-150)).toBe("mistake");
    expect(c(-450)).toBe("blunder");
  });

  it("handles mates separately", () => {
    const mateW = (n: number): Evaluation => ({ kind: "mate", moves: n, winner: "w" });
    const mateB = (n: number): Evaluation => ({ kind: "mate", moves: n, winner: "b" });
    expect(classifyMove({ ...base, move: nf3, before: pa(mateW(3), ["e2e4"]), after: pa(mateW(3)) }).cls).toBe("excellent");
    expect(classifyMove({ ...base, move: nf3, before: pa(mateW(3), ["e2e4"]), after: pa(mateW(6)) }).cls).toBe("good");
    expect(classifyMove({ ...base, move: nf3, before: pa(mateW(3), ["e2e4"]), after: pa(cp(50)) }).cls).toBe("mistake");
    expect(classifyMove({ ...base, move: nf3, before: pa(cp(20), ["e2e4"]), after: pa(mateB(1)) }).cls).toBe("blunder");
  });

  it("labels forced and book moves", () => {
    expect(classifyMove({ ...base, legalMoves: 1, move: nf3, before: pa(cp(0)), after: pa(cp(-300)) }).cls).toBe("forced");
    expect(classifyMove({ ...base, inBook: true, move: e4, before: pa(cp(30)), after: pa(cp(30)) }).cls).toBe("book");
  });

  it("calls a best move Great when every alternative is clearly worse", () => {
    const r = classifyMove({ ...base, move: e4, before: pa(cp(80), ["e2e4"], cp(-150)), after: pa(cp(80)) });
    expect(r.cls).toBe("great");
    // ...but not when you're winning anyway.
    expect(classifyMove({ ...base, move: e4, before: pa(cp(1200), ["e2e4"], cp(900)), after: pa(cp(1200)) }).cls).toBe("best");
  });

  it("calls an unpunished opponent mistake a Miss", () => {
    const prev = { cls: "blunder", before: 0.55, move: { ply: 1 } } as unknown as ClassifiedMove;
    // We were at 45% before their blunder, the best reply would give 95%, we played something worth 50%.
    const r = classifyMove({ ...base, move: nf3, previous: prev, before: pa(cp(500), ["e2e4"]), after: pa(cp(10)) });
    expect(r.cls).toBe("miss");
  });

  it("computes Lichess-style accuracy", () => {
    expect(moveAccuracy(50, 50)).toBeCloseTo(100, 0);
    expect(moveAccuracy(80, 40)).toBeLessThan(25);
    expect(expectedScore(cp(0), "w")).toBeCloseTo(0.5);
  });
});

describe("game review with engine-free analysis", () => {
  it("classifies a whole game and computes accuracy", () => {
    const g = parseGame(SHILLING_TRAP);
    // Fake but consistent evals (White's view): 4.Nxe5 is dubious, 5.Nxf7?? walks into mate.
    const evals: Evaluation[] = [20, 30, 25, 30, 25, 40, -150, -160, -1500, -1500, -1500, -1600, -1600, -1700].map(cp);
    const positions: PositionAnalysis[] = evals.map((e, i) => pa(e, i < g.moves.length ? [g.moves[i].uci] : []));
    positions[6] = pa(cp(40), ["c3c3"]); // best before 4.Nxe5 was something else
    positions[8] = pa(cp(-160), ["e5g4"]); // best before 5.Nxf7 was Ng4
    positions.push(pa({ kind: "mate", moves: 0, winner: "b" }));
    const r = classifyGame(g, positions, book);
    expect(r.moves.slice(0, 4).every((m) => m.cls === "book")).toBe(true);
    expect(r.moves[8].move.san).toBe("Nxf7");
    expect(r.moves[8].cls).toBe("blunder");
    expect(r.moves[13].cls).toBe("best"); // mate
    const acc = gameAccuracy(r.moves);
    expect(acc.w!).toBeGreaterThan(0);
    expect(acc.w!).toBeLessThan(acc.b!);
  });
});

describe("two-pass review", () => {
  it("re-searches only the positions around tactical labels, deeper", async () => {
    const g = parseGame(SHILLING_TRAP);
    const calls: { fen: string; depth: number }[] = [];
    // A fake engine: level until White's 5.Nxf7, then Black is winning.
    const fake = async (r: { fen: string; depth: number }) => {
      calls.push(r);
      const i = [g.startFen, ...g.moves.map((m) => m.fenAfter)].indexOf(r.fen);
      const e = i >= 9 ? cp(-900) : cp(20);
      return [{ multipv: 1, depth: r.depth, eval: e, pv: [] }];
    };
    const first = await analysePositions(g, [fake, fake], { depth: 10 });
    expect(calls).toHaveLength(14); // 15 positions; the final mate needs no search
    const review = classifyGame(g, first, book);
    expect(review.moves[8].cls).toBe("blunder"); // 5.Nxf7??
    const crit = criticalPositions(review, first, 14);
    expect(crit).toEqual([8, 9]);
    calls.length = 0;
    const second = await analysePositions(g, [fake], { depth: 14, indices: crit, existing: first });
    expect(calls.map((c) => c.depth)).toEqual([14, 14]);
    expect(second[8]!.depth).toBe(14);
    expect(second[3]).toBe(first[3]);
  });
});

describe("accuracy on Chess.com's scale", () => {
  it("maps perfect play to 100 and keeps the order of better and worse games", async () => {
    const { gameAccuracy: acc, moveAccuracyFor } = await import("./accuracy");
    expect(moveAccuracyFor(60, 60)).toBeCloseTo(100, 0);
    const mk = (before: number, after: number, color: "w" | "b" = "w") => ({ move: { color }, before, after, cls: "best" }) as unknown as ClassifiedMove;
    const perfect = acc([mk(0.6, 0.6), mk(0.5, 0.5)]);
    expect(perfect.w).toBe(100);
    const sloppy = acc([mk(0.6, 0.55), mk(0.55, 0.45), mk(0.5, 0.2)]);
    expect(sloppy.w!).toBeLessThan(80);
    expect(sloppy.w!).toBeGreaterThanOrEqual(0);
    expect(perfect.b).toBeNull();
  });
});
