/**
 * End-to-end game review with the real Stockfish build, on unrelated games. The
 * same code path classifies every one: nothing here is tuned to a particular game.
 */
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import openings from "@/data/openings.json";
import { EngineClient } from "../engine/client";
import type { Searcher } from "../deep/deep";
import { makeBook } from "./book";
import { classifyMove, terminalEval, type PositionAnalysis } from "./classify";
import { GAME_OF_THE_CENTURY, OPERA_GAME } from "./fixtures/games";
import { parseGame } from "./pgn";
import { analysePositions, classifyGame, tally } from "./review";
import { gameAccuracy } from "./accuracy";
import { explainReviewMove } from "./explain";
import { IMMORTAL_GAME, KASPAROV_TOPALOV } from "./samples";
import { Chess } from "chess.js";

const require = createRequire(import.meta.url);
const book = makeBook(openings as { book: string[]; names: Record<string, string> });
let search: Searcher;

beforeAll(async () => {
  const init = require("stockfish") as (f: string) => Promise<{ sendCommand(c: string): void; listener?: (l: string) => void }>;
  const e = await init("lite-single");
  const client = new EngineClient({ post: (c) => e.sendCommand(c), onLine: (cb) => { e.listener = cb; }, onError: () => undefined, terminate: () => undefined });
  await client.ready;
  search = (r) => client.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves, fresh: r.fresh }).promise.then((s) => s.lines);
}, 60_000);

async function analyse(fen: string, depth: number): Promise<PositionAnalysis> {
  const t = terminalEval(fen);
  if (t) return { lines: [], eval: t, depth: 0 };
  const lines = await search({ fen, depth, multipv: 2 });
  return { lines, eval: lines[0].eval, depth: lines[0].depth };
}

describe("game review on real games", () => {
  it("reviews Morphy's Opera Game: book opening, 16.Qb8+!! brilliant, mate is best", async () => {
    const g = parseGame(OPERA_GAME);
    const positions = await analysePositions(g, [search], { depth: 12 });
    const r = classifyGame(g, positions, book);
    expect(r.moves).toHaveLength(33);
    expect(r.moves[0].cls).toBe("book");
    expect(r.opening?.name).toMatch(/Philidor/);
    const qb8 = r.moves[30];
    expect(qb8.move.san).toBe("Qb8+");
    expect(qb8.cls).toBe("brilliant");
    expect(r.moves[32].cls).toBe("best");
    const acc = gameAccuracy(r.moves);
    expect(acc.w!).toBeGreaterThan(acc.b!);
    expect(Object.keys(tally(r.moves)).length).toBeGreaterThan(2);

    // Every move gets an explanation; the sacrifice one names the piece and the mate.
    const stories = r.moves.map((m, i) => explainReviewMove(m, r.moves[i - 1]));
    for (const s of stories) expect(s.headline.length).toBeGreaterThan(10);
    expect(stories[30].points.map((p) => p.text).join(" ")).toMatch(/queen on b8.*checkmate/s);
  }, 300_000);

  it("reviews and explains two more unrelated games end to end", async () => {
    for (const pgn of [IMMORTAL_GAME, KASPAROV_TOPALOV]) {
      const g = parseGame(pgn);
      const positions = await analysePositions(g, [search], { depth: 10 });
      const r = classifyGame(g, positions, book);
      expect(r.moves).toHaveLength(g.moves.length);
      const last = r.moves.at(-1)!;
      if (last.move.isMate) expect(last.cls).toBe("best");
      for (let i = 0; i < r.moves.length; i++) {
        const s = explainReviewMove(r.moves[i], r.moves[i - 1]);
        expect(s.headline).toContain(r.moves[i].move.san);
        if (["inaccuracy", "mistake", "blunder", "miss"].includes(r.moves[i].cls)) expect(s.points.length).toBeGreaterThan(0);
      }
      const acc = gameAccuracy(r.moves);
      expect(acc.w).not.toBeNull();
      expect(acc.b).not.toBeNull();
    }
  }, 400_000);

  it("labels Fischer's 17...Be6 (queen left en prise) brilliant", async () => {
    const m = parseGame(GAME_OF_THE_CENTURY).moves[33];
    expect(m.san).toBe("Be6");
    const before = await analyse(m.fenBefore, 16);
    const after = await analyse(m.fenAfter, 15);
    const c = classifyMove({ move: m, before, after, legalMoves: new Chess(m.fenBefore).moves().length, inBook: false });
    expect(["brilliant"]).toContain(c.cls);
    expect(c.sacrifice?.pieces.some((p) => p.type === "q")).toBe(true);
  }, 200_000);

  it("labels 43.g4 (knight on c1 left en prise) brilliant in a third, unrelated game", async () => {
    const fen = "7r/1pp1nk2/2n2p2/1bPp2q1/3P3p/rPB2RP1/5Q1P/2NBR1K1 w - - 3 43";
    const g = parseGame(`[SetUp "1"]\n[FEN "${fen}"]\n\n43. g4 *`);
    const before = await analyse(fen, 18);
    const after = await analyse(g.moves[0].fenAfter, 17);
    const c = classifyMove({ move: g.moves[0], before, after, legalMoves: new Chess(fen).moves().length, inBook: false });
    expect(c.cls).toBe("brilliant");
  }, 200_000);
});
