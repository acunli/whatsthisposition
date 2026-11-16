import { describe, expect, it } from "vitest";
import openings from "@/data/openings.json";
import type { Evaluation } from "../engine/score";
import { nodeSearcher } from "../eval/nodeEngine";
import { makeBook } from "../review/book";
import { parseGame } from "../review/pgn";
import { analysePositions, classifyGame } from "../review/review";
import { commonPlayer, fromGame, lineWins, sideOf } from "./build";
import { AS_GOOD, judgeAtOnce, judgeSearched } from "./judge";
import { MAX_PUZZLES, makeSet, trainingOrder, weaknesses } from "./profile";
import { forgetPuzzles, keepPuzzles, keptPuzzles } from "./store";
import type { Puzzle, Slip } from "./types";

const book = makeBook(openings as { book: string[]; names: Record<string, string> });
const cp = (n: number): Evaluation => ({ kind: "cp", cp: n });

const slip = (key: string, loss: number, over: Partial<Slip> = {}): Slip => {
  const [way, motif] = key.split(":") as [Slip["way"], Slip["motif"]];
  return { key, way, motif, phase: "middlegame", loss, rushed: false, game: 0, ply: 20, ...over };
};
const puzzle = (id: string, key: string, loss: number): Puzzle => ({
  id,
  key,
  way: "allowed",
  motif: "fork",
  phase: "middlegame",
  fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
  solver: "w",
  task: "better",
  solution: ["a1a2"],
  eval: cp(0),
  played: { label: "1.Kb1", uci: "a1b1", fen: "8/8/8/8/8/8/8/K6k w - - 0 1" },
  punishment: [],
  source: { game: 0, white: "A", black: "B", player: "w" },
  point: "",
  inGame: "",
  loss,
});

describe("puzzles: what a line wins", () => {
  it("counts a line that starts quietly and wins something a few moves in", () => {
    // 1.Qa4 (quiet, attacking two bishops) Rb6 2.Qxa5: a bishop, though the capture comes on the third ply.
    const fen = "1r3rk1/p1p1qppp/b1p1p3/b3P3/2pP4/P1P5/3BBPPP/1R1Q1RK1 w - - 3 15";
    expect(lineWins(fen, ["d1a4", "b8b6", "a4a5", "f8b8"], "w")).toMatchObject({ mine: ["b"], swing: 3 });
  });

  it("doesn't count a capture that is taken back", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3";
    expect(lineWins(fen, ["e5d4", "f3d4", "g8f6", "b1c3"], "b").swing).toBe(0);
  });

  it("stops at a settled point, not in the middle of an exchange", () => {
    // …Nxd4 Nxd4 exd4 Qxd4: knight for knight and pawn for pawn. Cut after …Nxd4 it would look like a knight won.
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3";
    expect(lineWins(fen, ["c6d4", "f3d4", "e5d4", "d1d4"], "b", 3).swing).toBe(0);
  });
});

describe("puzzles: from a game to mistakes and positions", () => {
  it("turns walking into mate into a puzzle from the other side", async () => {
    const search = await nodeSearcher();
    const game = parseGame('[White "Scholar"]\n[Black "Pupil"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0');
    const positions = await analysePositions(game, [search], { depth: 10 });
    const review = classifyGame(game, positions, book);
    const { slips, puzzles, moves } = fromGame({ game, review, positions, player: "b", index: 0 });
    expect(moves).toBe(3);
    const mate = slips.find((s) => s.ply === 6)!;
    expect(mate).toMatchObject({ key: "allowed:mate", way: "allowed", motif: "mate" });
    const p = puzzles.find((x) => x.id === mate.puzzle)!;
    // The position after 3…Nf6, White to move: find the mate that was allowed.
    expect(p).toMatchObject({ task: "punish", solver: "w", fen: game.moves[5].fenAfter });
    expect(p.solution[0]).toBe("h5f7");
    expect(p.played.label).toBe("3…Nf6");
    expect(p.point).toMatch(/4\.Qxf7#, and it is mate\./);
    // The winner made no mistakes worth a puzzle.
    expect(fromGame({ game, review, positions, player: "w", index: 0 }).slips).toEqual([]);
  }, 60_000);

  it("knows which side a named player has, and who a set of games is about", () => {
    const a = parseGame('[White "Ann"]\n[Black "Bo"]\n\n1. e4 e5 1/2-1/2');
    const b = parseGame('[White "Cy"]\n[Black "ann"]\n\n1. d4 d5 1/2-1/2');
    expect(sideOf(a, "ann")).toBe("w");
    expect(sideOf(b, "Ann ")).toBe("b");
    expect(sideOf(a, "Dee")).toBeNull();
    expect(commonPlayer([a, b])).toBe("Ann");
    expect(commonPlayer([a])).toBe("Ann");
  });
});

describe("puzzles: weaknesses and training order", () => {
  const slips = [
    slip("allowed:hanging", 0.5, { game: 0, puzzle: "h1" }),
    slip("allowed:hanging", 0.3, { game: 1, puzzle: "h2" }),
    slip("allowed:hanging", 0.2, { game: 1 }),
    slip("missed:fork", 0.4, { game: 2, puzzle: "f1" }),
    slip("slip:endgame", 0.1, { game: 2, phase: "endgame" }),
  ];

  it("groups the mistakes, costliest first, and says how often and when", () => {
    const w = weaknesses(slips);
    expect(w.map((x) => x.key)).toEqual(["allowed:hanging", "missed:fork", "slip:endgame"]);
    expect(w[0]).toMatchObject({ name: "Pieces left hanging", count: 3, games: 2, puzzles: ["h1", "h2"] });
    expect(w[0].loss).toBeCloseTo(1.0);
    expect(w[0].text).toMatch(/^Three times, a piece was left.*Mostly in the middlegame\.$/);
    expect(w[1].text).toMatch(/^Once,/);
  });

  it("mentions the clock when most of them came with seconds left", () => {
    const rushed = weaknesses([slip("allowed:hanging", 0.3, { rushed: true }), slip("allowed:hanging", 0.3, { rushed: true }), slip("allowed:hanging", 0.3)]);
    expect(rushed[0].text).toMatch(/2 of those with less than half a minute on the clock/);
  });

  it("leads with the costliest weakness and then takes turns", () => {
    const puzzles = [puzzle("f1", "missed:fork", 0.4), puzzle("h2", "allowed:hanging", 0.3), puzzle("h1", "allowed:hanging", 0.5)];
    expect(trainingOrder(puzzles, weaknesses(slips)).map((p) => p.id)).toEqual(["h1", "f1", "h2"]);
  });

  it("keeps a set to a session's length and only counts the puzzles it kept", () => {
    const many = Array.from({ length: MAX_PUZZLES + 9 }, (_, i) => puzzle(`p${i}`, "allowed:hanging", 0.2));
    const set = makeSet([{ slips: many.map((p) => slip(p.key, p.loss, { puzzle: p.id })), puzzles: many, moves: 400 }], "Ann", 123);
    expect(set.puzzles).toHaveLength(MAX_PUZZLES);
    expect(set.weaknesses[0].puzzles).toHaveLength(MAX_PUZZLES);
    expect(set.slips.filter((s) => s.puzzle)).toHaveLength(MAX_PUZZLES);
    expect(set).toMatchObject({ v: 1, made: 123, player: "Ann", games: 1, moves: 400 });
  });
});

describe("puzzles: is the move right", () => {
  const p = { solution: ["e2e4", "e7e5"], task: "better" as const, played: { uci: "g1h3" } };
  it("takes the answer, and knows the move from the game", () => {
    expect(judgeAtOnce("e2e4", p)).toBe("answer");
    expect(judgeAtOnce("g1h3", p)).toBe("game-move");
    expect(judgeAtOnce("d2d4", p)).toBeNull();
    // From the opponent's side there is no "move from the game" to repeat.
    expect(judgeAtOnce("g1h3", { ...p, task: "punish" })).toBeNull();
  });

  it("accepts another move the engine rates about as highly, and no worse one", () => {
    expect(judgeSearched(cp(120), cp(110), "w")).toBe("as-good");
    expect(judgeSearched(cp(120), cp(-40), "w")).toBe("wrong");
    // For Black the lower number is the better one.
    expect(judgeSearched(cp(-120), cp(-110), "b")).toBe("as-good");
    expect(judgeSearched(cp(-120), cp(60), "b")).toBe("wrong");
    expect(AS_GOOD).toBeLessThan(0.05);
  });

  it("wants a mate to stay a mate", () => {
    const mate: Evaluation = { kind: "mate", moves: 2, winner: "w" };
    expect(judgeSearched(mate, { kind: "mate", moves: 4, winner: "w" }, "w")).toBe("as-good");
    expect(judgeSearched(mate, cp(900), "w")).toBe("wrong");
  });
});

describe("puzzles: the kept set", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  const set = makeSet([{ slips: [slip("missed:fork", 0.4, { puzzle: "f1" })], puzzles: [puzzle("f1", "missed:fork", 0.4)], moves: 30 }], undefined, 5);

  it("comes back as it was kept", () => {
    const s = memory();
    expect(keptPuzzles(s)).toBeNull();
    keepPuzzles({ set, done: { f1: "first" }, at: 0 }, s);
    expect(keptPuzzles(s)).toEqual({ set, done: { f1: "first" }, at: 0 });
    forgetPuzzles(s);
    expect(keptPuzzles(s)).toBeNull();
  });

  it("starts fresh from anything it can't read, or from no storage at all", () => {
    const s = memory();
    s.setItem("wtp-puzzles", "{not json");
    expect(keptPuzzles(s)).toBeNull();
    s.setItem("wtp-puzzles", JSON.stringify({ set: { v: 2 }, done: {}, at: 0 }));
    expect(keptPuzzles(s)).toBeNull();
    s.setItem("wtp-puzzles", JSON.stringify({ set, at: 99 }));
    expect(keptPuzzles(s)).toMatchObject({ done: {}, at: 0 });
    expect(keptPuzzles(null)).toBeNull();
    expect(() => keepPuzzles({ set, done: {}, at: 0 }, null)).not.toThrow();
  });
});
