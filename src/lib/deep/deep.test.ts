/**
 * Runs the real Stockfish build on a test position where 43.g4!! is a pawn
 * sacrifice: ...Qxg4+ runs into Kh1 and the g-file opens for White's rooks.
 * (Game review is tested on several unrelated games in src/lib/review.)
 */
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { EngineClient } from "../engine/client";
import { lossClass } from "../review/classify";
import { analyzeMoveDeep, classification, type Searcher } from "./deep";

const require = createRequire(import.meta.url);
const FEN = "7r/1pp1nk2/2n2p2/1bPp2q1/3P3p/rPB2RP1/5Q1P/2NBR1K1 w - - 3 43";

let search: Searcher;

beforeAll(async () => {
  const init = require("stockfish") as (f: string) => Promise<{ sendCommand(c: string): void; listener?: (l: string) => void }>;
  const e = await init("lite-single");
  const client = new EngineClient({ post: (c) => e.sendCommand(c), onLine: (cb) => { e.listener = cb; }, onError: () => undefined, terminate: () => undefined });
  await client.ready;
  search = (r) => client.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves }).promise.then((s) => s.lines);
}, 60_000);

describe("deep move understanding", () => {
  it("explains 43.g4!! as a poisoned pawn offer, from the engine's lines", async () => {
    const root = await search({ fen: FEN, depth: 18, multipv: 3 });
    expect(root[0].pv[0]).toBe("g3g4");
    const deep = await analyzeMoveDeep(FEN, root[0], search, { depth: 17, isBest: true, alternatives: root.slice(1) });
    expect(deep).not.toBeNull();
    const offer = deep!.offers.find((o) => o.san.startsWith("Qxg4"));
    expect(offer?.poisoned).toBe(true);
    expect(offer?.sans[1]).toMatch(/Kh1|Kf1/);
    expect(offer?.text).toMatch(/the pawn is poisoned/);
    expect(deep!.classification.kind).toBe("brilliant");
    expect(deep!.headline).toMatch(/offers the pawn on g4/);
    expect(deep!.points.map((p) => p.text).join(" ")).toMatch(/Uncovers the queen on f2: it now hits the pawn on h4|Takes h5 away from the queen on g5/);
    expect(deep!.comparison?.san).toBeTruthy();
  }, 170_000);
});

describe("classification", () => {
  it("uses the game-review labels and annotation marks", () => {
    const cp = (n: number) => ({ kind: "cp" as const, cp: n });
    expect(classification(lossClass(cp(30), cp(25), "w")).label).toBe("Best");
    expect(classification(lossClass(cp(30), cp(-30), "w")).symbol).toBe("?!");
    expect(classification(lossClass(cp(30), cp(-150), "w")).symbol).toBe("?");
    expect(classification(lossClass(cp(30), cp(-400), "w")).symbol).toBe("??");
    expect(classification("brilliant").symbol).toBe("!!");
  });
});
