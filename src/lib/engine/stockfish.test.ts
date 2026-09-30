/**
 * Integration test against the real Stockfish WASM build shipped to browsers.
 * It pins down the score perspective that `normalizeScore` relies on and
 * exercises EngineClient end to end (multipv, searchmoves, cancel).
 */
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineClient, type EngineTransport } from "./client";

const require = createRequire(import.meta.url);

interface NodeEngine {
  sendCommand(cmd: string): void;
  listener?: (line: string) => void;
  terminate?: () => void;
}

async function nodeTransport(): Promise<EngineTransport> {
  const init = require("stockfish") as (flavor: string) => Promise<NodeEngine>;
  const engine = await init("lite-single");
  return {
    post: (cmd) => engine.sendCommand(cmd),
    onLine: (cb) => {
      engine.listener = cb;
    },
    onError: () => undefined,
    terminate: () => engine.terminate?.(),
  };
}

describe("Stockfish via EngineClient", () => {
  let client: EngineClient;

  beforeAll(async () => {
    client = new EngineClient(await nodeTransport());
    await client.ready;
  });

  afterAll(() => client?.cancelAll());

  it("reports White's advantage as positive regardless of side to move", async () => {
    const white = await client.analyze({ fen: "4k3/8/8/8/8/8/8/3QK3 w - - 0 1", multipv: 1, depth: 10 }).promise;
    const black = await client.analyze({ fen: "4k3/8/8/8/8/8/8/3QK3 b - - 0 1", multipv: 1, depth: 10 }).promise;
    expect(white.lines[0].eval.kind).toBe("cp");
    expect(black.lines[0].eval.kind).toBe("cp");
    if (white.lines[0].eval.kind === "cp") expect(white.lines[0].eval.cp).toBeGreaterThan(300);
    if (black.lines[0].eval.kind === "cp") expect(black.lines[0].eval.cp).toBeGreaterThan(300);
  });

  it("keeps mate scores separate and attributes them to the winner", async () => {
    const res = await client.analyze({ fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", multipv: 1, depth: 8 }).promise;
    expect(res.lines[0].eval).toEqual({ kind: "mate", moves: 1, winner: "w" });
    expect(res.bestMove).toBe("a1a8");
    // Black to move, but White is the one mating: the side-to-move score is negative.
    const res2 = await client.analyze({ fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1", multipv: 1, depth: 8 }).promise;
    expect(res2.lines[0].eval.kind === "cp" ? res2.lines[0].eval.cp : evalWinner(res2.lines[0].eval)).toBeGreaterThan(0);
  });

  it("returns several candidate lines and honours searchmoves", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const multi = await client.analyze({ fen, multipv: 3, depth: 8 }).promise;
    expect(multi.lines).toHaveLength(3);
    const only = await client.analyze({ fen, multipv: 1, depth: 8, searchmoves: ["g1h3"] }).promise;
    expect(only.lines[0].pv[0]).toBe("g1h3");
  });

  it("returns a White-relative static eval, and none when in check", async () => {
    const up = await client.staticEval("4k3/8/8/8/8/8/8/3QK3 b - - 0 1");
    expect(up).not.toBeNull();
    expect(up!).toBeGreaterThan(3);
    expect(await client.staticEval("4k3/8/8/8/8/8/8/4R1K1 b - - 0 1")).toBeNull();
  });

  it("can cancel a long search and still returns partial lines", async () => {
    const handle = client.analyze({ fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", multipv: 1, depth: 40 });
    await new Promise((r) => setTimeout(r, 400));
    handle.cancel();
    const snap = await handle.promise;
    expect(snap.cancelled).toBe(true);
    expect(snap.depth).toBeLessThan(40);
  });
});

function evalWinner(e: { kind: "mate"; winner: "w" | "b" } | { kind: "cp" }) {
  return e.kind === "mate" ? (e.winner === "w" ? 1 : -1) : 0;
}

