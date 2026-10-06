/**
 * The sacrifice explainer on real positions, with the real engine (Stockfish in Node).
 * Two unrelated kinds of brilliancy: an in-between capture that leaves a rook hanging,
 * and a rook thrown at the king where taking it is mate.
 */
import { describe, expect, it } from "vitest";
import { nodeSearcher } from "../eval/nodeEngine";
import { buildVariation } from "../variation";
import { explainSacrifice } from "./sacrifice";

/** As in the review: brilliant moves have depth-18 lines (the verification pass), and the explainer probes at 14. */
async function explain(fen: string, uci: string) {
  const search = await nodeSearcher();
  const best = await search({ fen, depth: 18, multipv: 2, fresh: true });
  const after = buildVariation(fen, [uci], 1).moves[0].fenAfter;
  const reply = (await search({ fen: after, depth: 18, multipv: 1, fresh: true }))[0];
  return explainSacrifice({ fen, uci, reply: { pv: reply.pv, eval: reply.eval, depth: reply.depth }, best: best[0], second: best[1], search, depth: 14 });
}

describe("why a sacrifice works", () => {
  it("explains an in-between capture: either piece can be taken, not both (30.Bxf8, Hikaru vs demon64fields)", async () => {
    const x = (await explain("r1r2bk1/p2q1p1p/1p1P2pB/4Pp2/R7/P1n2N1P/3Q1PP1/R5K1 w - - 2 30", "h6f8"))!;
    expect(x.headline).toMatch(/^30\.Bxf8!! ignores the attack on the rook on a4 and takes the bishop on f8 first\. Black can take only one of the two/);
    const titles = x.steps.map((s) => s.title);
    expect(titles).toEqual(expect.arrayContaining(["What White gives up", "What it does instead", "If Black takes the rook", "If Black takes back on f8", "Why not save the rook first?"]));
    const take = x.steps.find((s) => s.title === "If Black takes the rook")!;
    expect(take.text).toMatch(/is met by 31\.Be7, and the bishop on f8 gets away/);
    const back = x.steps.find((s) => s.title === "If Black takes back on f8")!;
    expect(back.text).toMatch(/31\.R[a-h]4, and the rook on a4 gets away/);
    // Every line named in a step can be watched.
    expect(take.lines?.map((l) => l.label)).toEqual([expect.stringMatching(/^30…/), "31.Be7"]);
  }, 120_000);

  it("explains a sacrifice where taking is mate (26.Rxg7, Naroditsky vs Nihal Sarin)", async () => {
    const x = (await explain("2r2r1k/pp3Bp1/7p/4pQR1/8/8/Pq3P1P/3RK3 w - - 0 26", "g5g7"))!;
    expect(x.headline).toMatch(/^26\.Rxg7!! offers the rook on g7\. Taking it leads to mate\./);
    const take = x.steps.find((s) => s.title === "If Black takes the rook")!;
    expect(take.text).toMatch(/26…Kxg7 is met by 27\.Qg6\+/);
    expect(take.text).toMatch(/mate/);
    expect(x.steps.some((s) => s.title === "Without the sacrifice")).toBe(true);
  }, 120_000);
});
