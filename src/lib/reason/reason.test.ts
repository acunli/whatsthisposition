import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EngineClient } from "../engine/client";
import type { Searcher } from "../deep/deep";
import { buildVariation } from "../variation";
import { boardIdeas, capturable, gainWords } from "./ideas";
import { narrate } from "./line";
import { gerund, reasonMove } from "./reason";
import { placementFromFen } from "../chess/fen";

/** Ideas for `uci` in `fen`, with an optional engine line after it. */
function ideasOf(fen: string, uci: string, after: string[] = [], evalAfter = 0) {
  const v = buildVariation(fen, [uci, ...after], 12);
  return boardIdeas(v.moves[0], { after: v.moves.slice(1), evalAfter, goodMove: true });
}
const kinds = (xs: { kind: string }[]) => xs.map((x) => x.kind);
const text = (xs: { text: string }[]) => xs.map((x) => x.text).join(" | ");

// The owner's example: after 21…Rh8 the engine plays 22.Qe3 Qh6 23.Qxh6 Rxh6.
const RH8 = "r4r2/pp2pkq1/3p1pp1/2p5/2P1PQ2/7P/P1B2PP1/2RR2K1 b - - 3 21";

describe("board ideas", () => {
  it("finds a real fork, but not one where the forking piece can simply be taken", () => {
    const fork = ideasOf("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5c7");
    expect(kinds(fork)).toContain("fork");
    expect(text(fork)).toMatch(/forks the king and the rook/);
    const fake = ideasOf("rb2k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5c7");
    expect(kinds(fake)).not.toContain("fork");
    expect(capturable(placementFromFen("rb2k3/2N5/8/8/8/8/8/4K3 b - - 1 1"), "c7")).toBe(true);
  });

  it("finds pins", () => {
    expect(text(ideasOf("4k3/3n4/8/8/8/8/8/4KB2 w - - 0 1", "f1b5"))).toMatch(/Pins the knight on d7 to the king/);
  });

  it("explains 21…Rh8: the half-open file, its target, and the queen trade it prepares", () => {
    const ideas = ideasOf(RH8, "f8h8", ["f4e3", "g7h6", "e3h6", "h8h6"]);
    expect(text(ideas)).toMatch(/half-open h-file, aiming at the h3 pawn/);
    expect(text(ideas)).toMatch(/prepares …Qh6, offering a trade of queens/);
    expect(text(ideas)).not.toMatch(/safe squares/);
  });

  it("names trades, new passed pawns and material plainly", () => {
    expect(kinds(ideasOf("3qk3/8/8/8/8/8/8/3QK3 w - - 0 1", "d1d8", ["e8d8"]))).toContain("trade");
    expect(text(ideasOf("4k3/8/8/2p5/1P6/8/8/4K3 w - - 0 1", "b4c5"))).toMatch(/passed pawn on c5/);
    expect(gainWords({ mine: ["q"], theirs: ["b"], swing: 6 })).toBe("the queen for a bishop");
    expect(gainWords({ mine: ["n", "p"], theirs: ["b"], swing: 1 })).toBe("a pawn");
    expect(gainWords({ mine: ["r"], theirs: ["n"], swing: 2 })).toBe("the exchange");
  });

  it("writes phrases a coach would", () => {
    expect(gerund("pins the knight")).toBe("pinning the knight");
    expect(gerund("takes the pawn")).toBe("taking the pawn");
    expect(gerund("forks the king and the rook")).toBe("forking the king and the rook");
    const after = buildVariation(RH8, ["f8h8"]).moves[0].fenAfter;
    expect(narrate(after, ["f4e3", "g7h6", "e3h6", "h8h6"], { kind: "cp", cp: 578 }, "b")?.text).toMatch(/the queens come off/);
  });
});

describe("move reasoning with the engine", () => {
  it("explains 21…Rh8 from the engine's own line, and finds what a blunder walks into", async () => {
    const require = createRequire(import.meta.url);
    const init = require("stockfish") as (f: string) => Promise<{ sendCommand(c: string): void; listener?: (l: string) => void }>;
    const e = await init("lite-single");
    const client = new EngineClient({ post: (c) => e.sendCommand(c), onLine: (cb) => { e.listener = cb; }, onError: () => undefined, terminate: () => undefined });
    await client.ready;
    const search: Searcher = (r) => client.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves }).promise.then((s) => s.lines);

    const rh8 = await reasonMove({ fen: RH8, uci: "f8h8", line: { pv: ["f8h8", "f4e3", "g7h6", "e3h6", "h8h6"], eval: { kind: "cp", cp: 578 }, depth: 14 }, search, depth: 12 });
    expect(rh8?.headline).toMatch(/h-file/);
    expect(rh8?.line?.text).toMatch(/queens come off/);

    // 11…Nc2+?? looks like a fork of king and queen, but the d3 bishop simply takes it.
    const fen = "r2q1rk1/ppp1ppb1/3p1npp/8/2PnP2B/2NBQ2P/PP3PP1/R3K2R b KQ - 1 11";
    const nc2 = await reasonMove({ fen, uci: "d4c2", search, depth: 12 });
    expect(kinds(nc2!.ideas)).not.toContain("fork");
    expect(nc2?.refutation?.text).toMatch(/Bxc2, winning a knight/);
  }, 180_000);
});
