import { describe, expect, it } from "vitest";
import { placementFromFen, START_FEN } from "../chess/fen";
import { makeCtx } from "./context";
import { computeFacts } from "./index";
import { holes, pawnChains } from "./structure";
import { spaceFor } from "./space";
import { tacticFacts } from "./tactics";
import { pieceFacts, dominanceMarks } from "./pieces";
import { buildLedger, ledgerBalance, polarityOf } from "./ledger";
import { buildAdvice } from "./advice";
import { buildTour } from "./tour";

describe("structure", () => {
  it("has no holes in the starting position", () => {
    const p = placementFromFen(START_FEN);
    expect(holes(p, "w")).toEqual([]);
    expect(holes(p, "b")).toEqual([]);
  });

  it("finds the hole on d5 after ...e5 and ...c5", () => {
    // Black pawns c5, e5: d5 can no longer be covered by a black pawn.
    const p = placementFromFen("4k3/pp3ppp/8/2p1p3/8/8/PPPPPPPP/4K3 w - - 0 1");
    expect(holes(p, "b")).toContain("d5");
    expect(holes(p, "b")).not.toContain("f6");
  });

  it("finds a pawn chain and its base", () => {
    const p = placementFromFen("4k3/8/8/4P3/3P4/2P5/8/4K3 w - - 0 1");
    expect(pawnChains(p, "w")).toEqual([expect.objectContaining({ base: "c3", head: "e5" })]);
  });

  it("measures space behind the pawns", () => {
    const p = placementFromFen("4k3/pp3ppp/2p1p3/3pP3/3P4/8/PPP2PPP/4K3 w - - 0 1");
    expect(spaceFor(p, "w").score).toBeGreaterThan(spaceFor(p, "b").score);
  });
});

describe("tactics", () => {
  it("spots a skewer of king and queen", () => {
    const ctx = makeCtx("8/8/8/3q4/8/3k4/8/3R2K1 w - - 0 1");
    const f = tacticFacts(ctx).find((x) => x.kind === "skewer");
    expect(f?.anchor).toBe("d3");
    expect(f?.marks.links?.[0]).toMatchObject({ from: "d1", to: "d5", kind: "xray" });
  });

  it("spots a back-rank weakness", () => {
    const ctx = makeCtx("3r2k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1");
    const kinds = tacticFacts(ctx).map((f) => `${f.kind}-${f.side}`);
    expect(kinds).toContain("back-rank-w");
    expect(kinds).not.toContain("back-rank-b"); // Black has no heavy piece threat against it
  });

  it("rates king danger higher when pieces swarm the king", () => {
    const safe = tacticFacts(makeCtx("r4rk1/ppp2ppp/8/8/8/8/PPP2PPP/R4RK1 w - - 0 1")).find((f) => f.id === "danger-b");
    const hot = tacticFacts(makeCtx("r4rk1/ppp2p1p/6pQ/8/8/5N2/PPP2PPP/R4RK1 w - - 0 1")).find((f) => f.id === "danger-b");
    expect(safe?.polarity).toBe("neutral");
    expect(Number(hot?.marks.badges[0].text)).toBeGreaterThan(Number(safe?.marks.badges[0].text));
  });
});

describe("pieces", () => {
  it("floods the squares a piece controls, nearest first", () => {
    const ctx = makeCtx("4k3/8/8/8/3N4/8/8/4K3 w - - 0 1");
    const m = dominanceMarks(ctx, "d4");
    const flood = m.squares.filter((s) => s.style === "flood");
    expect(flood).toHaveLength(8);
    expect(flood.every((s) => s.tone === "white")).toBe(true);
  });

  it("labels a knight on the rim", () => {
    expect(pieceFacts(makeCtx("4k3/8/8/N7/8/8/8/4K3 w - - 0 1")).map((f) => f.kind)).toContain("knight-rim");
  });
});

describe("ledger, advice and tour", () => {
  const fen = "4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1";

  it("sorts facts into strengths and weaknesses per side", () => {
    const facts = computeFacts("4k3/8/8/3P4/8/8/8/4K3 w - - 0 1");
    const ledger = buildLedger(facts);
    expect(ledger.w.strengths.map((e) => e.label)).toContain("Passed d5 pawn");
    expect(ledger.w.weaknesses.map((e) => e.fact.kind)).not.toContain("passed");
    expect(ledgerBalance(ledger, "w")).toBeGreaterThan(0);
  });

  it("gives a hanging piece to its owner as a weakness", () => {
    const facts = computeFacts(fen);
    const hanging = facts.byLens.threats.find((f) => f.kind === "hanging" && f.anchor === "e5")!;
    expect(polarityOf(hanging)).toBe("weakness");
    const ledger = buildLedger(facts);
    expect(ledger.b.weaknesses.some((e) => e.fact.id === hanging.id)).toBe(true);
  });

  it("turns the opponent's weaknesses into things to try, and cites the fact", () => {
    const facts = computeFacts(fen);
    const advice = buildAdvice(buildLedger(facts), facts.ctx.p, "w", { best: { san: "Nxe5", side: "w" }, engineFirstMoves: ["f3e5"] });
    expect(advice.w[0]).toMatchObject({ kind: "now", evidence: "engine" });
    const atk = advice.w.find((a) => a.kind === "attack");
    expect(atk?.text).toBe("Win material: take the knight on e5.");
    expect(atk?.fact?.anchor).toBe("e5");
  });

  it("warns instead of advising a capture the engine avoids", () => {
    const facts = computeFacts("r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const advice = buildAdvice(buildLedger(facts), facts.ctx.p, "w", { engineFirstMoves: ["f3d4", "c4f7"] });
    expect(advice.w.map((a) => a.text)).toContain("The pawn on e5 looks free, but the engine won't take it. Work out why before you grab it.");
  });

  it("puts a mate in one first and alone", () => {
    const facts = computeFacts("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
    const advice = buildAdvice(buildLedger(facts), facts.ctx.p, "w");
    expect(advice.w).toHaveLength(1);
    expect(advice.w[0].text).toMatch(/Qxf7# is checkmate/);
  });

  it("starts the tour with the urgent tactics", () => {
    const facts = computeFacts(fen);
    const tour = buildTour(buildLedger(facts), "w");
    expect(tour.length).toBeGreaterThan(1);
    expect(["hanging", "attacked-by-cheaper"]).toContain(tour[0].fact.kind);
    expect(new Set(tour.map((s) => s.id)).size).toBe(tour.length);
  });
});
