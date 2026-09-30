import { describe, expect, it } from "vitest";
import { describeEval, evalBarShare, evalLoss, evalToNumber, formatEval, normalizeScore, type Evaluation } from "./score";
import { parseBestMove, parseInfoLine } from "./uci";

describe("normalizeScore (side-to-move → White's view)", () => {
  it("keeps centipawns when White is to move and flips them when Black is", () => {
    expect(normalizeScore({ kind: "cp", value: 120 }, "w")).toEqual({ kind: "cp", cp: 120 });
    expect(normalizeScore({ kind: "cp", value: 120 }, "b")).toEqual({ kind: "cp", cp: -120 });
    expect(normalizeScore({ kind: "cp", value: -45 }, "b")).toEqual({ kind: "cp", cp: 45 });
  });

  it("assigns mate scores to the right winner", () => {
    expect(normalizeScore({ kind: "mate", value: 3 }, "w")).toEqual({ kind: "mate", moves: 3, winner: "w" });
    expect(normalizeScore({ kind: "mate", value: 3 }, "b")).toEqual({ kind: "mate", moves: 3, winner: "b" });
    expect(normalizeScore({ kind: "mate", value: -2 }, "w")).toEqual({ kind: "mate", moves: 2, winner: "b" });
    expect(normalizeScore({ kind: "mate", value: -2 }, "b")).toEqual({ kind: "mate", moves: 2, winner: "w" });
  });

  it("treats `mate 0` as the side to move already being mated", () => {
    expect(normalizeScore({ kind: "mate", value: 0 }, "b")).toEqual({ kind: "mate", moves: 0, winner: "w" });
    expect(normalizeScore({ kind: "mate", value: 0 }, "w")).toEqual({ kind: "mate", moves: 0, winner: "b" });
  });
});

describe("evaluation ordering and display", () => {
  const cp = (n: number): Evaluation => ({ kind: "cp", cp: n });
  const mate = (moves: number, winner: "w" | "b"): Evaluation => ({ kind: "mate", moves, winner });

  it("ranks mates above any centipawn score and faster mates above slower ones", () => {
    const sorted = [cp(900), mate(5, "w"), mate(2, "w"), cp(-300), mate(1, "b")].sort((a, b) => evalToNumber(b) - evalToNumber(a));
    expect(sorted).toEqual([mate(2, "w"), mate(5, "w"), cp(900), cp(-300), mate(1, "b")]);
  });

  it("formats scores from White's view and keeps mate distinct", () => {
    expect(formatEval(cp(125))).toBe("+1.25");
    expect(formatEval(cp(-40))).toBe("−0.40");
    expect(formatEval(cp(0))).toBe("0.00");
    expect(formatEval(mate(3, "w"))).toBe("#3");
    expect(formatEval(mate(3, "b"))).toBe("#−3");
    expect(formatEval(mate(0, "w"))).toBe("1-0");
  });

  it("describes who is better in words", () => {
    expect(describeEval(cp(10)).headline).toBe("Roughly equal");
    expect(describeEval(cp(-60))).toMatchObject({ leader: "b", strength: "slight" });
    expect(describeEval(cp(180))).toMatchObject({ leader: "w", strength: "clear" });
    expect(describeEval(cp(-700))).toMatchObject({ leader: "b", strength: "winning" });
    expect(describeEval(mate(4, "b"))).toMatchObject({ leader: "b", strength: "mate", headline: "Black forces mate in 4" });
  });

  it("measures loss from the mover's perspective and clamps mates", () => {
    expect(evalLoss(cp(100), cp(-50), "w")).toBe(150);
    expect(evalLoss(cp(-100), cp(50), "b")).toBe(150);
    expect(evalLoss(cp(100), cp(200), "w")).toBe(0);
    expect(evalLoss(mate(2, "w"), cp(300), "w")).toBe(1700);
  });

  it("maps evaluations onto the bar monotonically", () => {
    expect(evalBarShare(cp(0))).toBeCloseTo(0.5);
    expect(evalBarShare(cp(300))).toBeGreaterThan(evalBarShare(cp(100)));
    expect(evalBarShare(mate(1, "w"))).toBe(1);
    expect(evalBarShare(mate(1, "b"))).toBe(0);
  });
});

describe("UCI parsing", () => {
  it("parses a multipv info line", () => {
    const info = parseInfoLine(
      "info depth 18 seldepth 25 multipv 2 score cp -34 nodes 123456 nps 800000 hashfull 12 tbhits 0 time 154 pv e7e5 g1f3 b8c6",
    );
    expect(info).toMatchObject({ depth: 18, multipv: 2, score: { kind: "cp", value: -34 }, pv: ["e7e5", "g1f3", "b8c6"], timeMs: 154 });
  });

  it("parses mate scores, bounds and promotions", () => {
    expect(parseInfoLine("info depth 5 score mate -2 pv a7a8q")?.score).toEqual({ kind: "mate", value: -2 });
    expect(parseInfoLine("info depth 20 score cp 50 lowerbound nodes 1 pv e2e4")?.bound).toBe("lower");
    expect(parseInfoLine("info depth 20 score cp 50 pv a7a8q")?.pv).toEqual(["a7a8q"]);
  });

  it("ignores non-search info", () => {
    expect(parseInfoLine("info string NNUE evaluation using nn.nnue")).toBeNull();
    expect(parseInfoLine("info currmove e2e4 currmovenumber 1")).toBeNull();
  });

  it("parses bestmove including (none)", () => {
    expect(parseBestMove("bestmove e2e4 ponder e7e5")).toEqual({ best: "e2e4", ponder: "e7e5" });
    expect(parseBestMove("bestmove (none)")).toEqual({ best: null, ponder: undefined });
  });
});
