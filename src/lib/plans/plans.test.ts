import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EngineClient } from "../engine/client";
import type { Searcher } from "../deep/deep";
import { makeCtx } from "../facts/context";
import { findPlans } from "../facts/plans";
import { findThreat } from "../reason/reason";
import { planCard } from "./cards";
import { planTiming } from "./timing";

// The owner's example: White to move, the queen on f3 is attacked by the knight on d4.
const FEN = "r2q1rk1/ppp1ppb1/3p1npp/8/2PnP2B/2NB1Q1P/PP3PP1/R3K2R w KQ - 0 11";

describe("plan cards", () => {
  it("weighs castling on each wing from the board", () => {
    const plans = findPlans(makeCtx(FEN));
    const ks = plans.find((p) => p.id === "castle-K")!;
    const qs = plans.find((p) => p.id === "castle-Q")!;
    const k = planCard(FEN, ks);
    const q = planCard(FEN, qs);
    expect(k.keySan).toBe("O-O");
    expect(k.benefits.map((b) => b.text).join(" ")).toMatch(/behind 3 pawns/);
    expect(q.drawbacks.map((b) => b.text).join(" ")).toMatch(/Only one pawn \(b2\)/);
    expect(q.benefits.map((b) => b.text).join(" ")).toMatch(/half-open d-file, already aiming at the knight on d4/);
    expect(k.meter.defence).toBeGreaterThan(q.meter.defence);
    expect(q.meter.risk).toBeGreaterThan(k.meter.risk);
  });
});

describe("plan timing with the engine", () => {
  it("says castling has to wait while the queen is attacked, and why", async () => {
    const require = createRequire(import.meta.url);
    const init = require("stockfish") as (f: string) => Promise<{ sendCommand(c: string): void; listener?: (l: string) => void }>;
    const e = await init("lite-single");
    const client = new EngineClient({ post: (c) => e.sendCommand(c), onLine: (cb) => { e.listener = cb; }, onError: () => undefined, terminate: () => undefined });
    await client.ready;
    const search: Searcher = (r) => client.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves }).promise.then((s) => s.lines);
    const best = (await search({ fen: FEN, depth: 12 }))[0];
    const line = { pv: best.pv, eval: best.eval, depth: best.depth };
    const threat = await findThreat(FEN, search, 10, best.eval);
    expect(threat?.san).toMatch(/Nxf3/);
    const card = planCard(FEN, findPlans(makeCtx(FEN)).find((p) => p.id === "castle-K")!);
    const t = await planTiming(FEN, card, line, search, 12, threat);
    expect(t.verdict).toBe("not-now");
    expect(t.text).toMatch(/Nxf3\+.*queen/);
  }, 120_000);
});
