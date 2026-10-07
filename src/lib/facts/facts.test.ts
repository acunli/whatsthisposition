import { describe, expect, it } from "vitest";
import { START_FEN } from "../chess/fen";
import { computeFacts, marksForLenses } from "./index";
import { makeCtx } from "./context";
import { escapeSquares } from "./king";
import { classifyPawns } from "./pawns";
import { isOutpost } from "./activity";
import { materialSummary } from "./material";
import { traceSquare } from "./trace";
import { findPlans } from "./plans";
import { explainMove, explainWhyNot, staticMovePoints } from "./explain";
import { buildVariation } from "../variation";
import { placementFromFen } from "../chess/fen";

const kinds = (fen: string, lens: Parameters<typeof marksForLenses>[1][number]) =>
  computeFacts(fen).byLens[lens].map((f) => `${f.kind}@${f.anchor}`);

describe("threat facts", () => {
  it("anchors a hanging piece to its square with arrows from the attacker", () => {
    // The knights on e5 and f3 attack each other and neither is defended.
    const fen = "4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1";
    const facts = computeFacts(fen).byLens.threats;
    const hanging = facts.find((f) => f.kind === "hanging" && f.anchor === "e5");
    expect(hanging?.anchor).toBe("e5");
    expect(hanging?.side).toBe("b");
    expect(hanging?.marks.arrows).toEqual([{ from: "f3", to: "e5", tone: "opportunity" }]);
    expect(hanging?.title).toMatch(/undefended/);
  });

  it("does not call a defended piece attacked by an equal piece hanging", () => {
    const fen = "4k3/3p4/4n3/8/3N4/8/8/4K3 w - - 0 1";
    expect(kinds(fen, "threats")).not.toContain("hanging@e6");
  });

  it("respects pins when counting who can capture", () => {
    // The e4 knight is pinned to the e1 king by the e8 rook, so it can't take on d6.
    const fen = "4r1k1/8/3b4/8/4N3/8/8/4K3 w - - 0 1";
    const ctx = makeCtx(fen);
    expect(ctx.capturers("d6", "w")).toEqual([]);
    expect(kinds(fen, "threats")).toContain("pin-absolute@e4");
  });

  it("finds a knight fork already on the board and a fork move", () => {
    const fork = "r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1";
    expect(kinds(fork, "threats")).toContain("fork@c7");
    const forkMove = "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1";
    const f = computeFacts(forkMove).byLens.threats.find((x) => x.kind === "fork-move");
    expect(f?.title).toMatch(/^Nc7\+ would attack/);
    expect(f?.evidence).toBe("idea");
  });

  it("marks fork moves engine-backed only when the engine lists them", () => {
    const forkMove = "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1";
    const f = computeFacts(forkMove, { firstMoves: ["b5c7"] }).byLens.threats.find((x) => x.kind === "fork-move");
    expect(f?.evidence).toBe("engine");
  });

  it("reports mate in one from the rules", () => {
    expect(kinds("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "threats")).toContain("mate-in-one@a8");
  });

  it("reports the one safe square of an attacked piece", () => {
    // The a1 knight is hit by the d4 bishop; b3 is covered by the a4 pawn, leaving only c2.
    const fen = "4k3/8/8/8/p2b4/8/8/N3K3 w - - 0 1";
    const f = computeFacts(fen).byLens.threats.find((x) => x.anchor === "a1");
    expect(f?.title).toBe("White's knight on a1 is attacked and has only one safe square (c2).");
  });
});

describe("king safety facts", () => {
  it("computes escape squares with the king removed from slider lines", () => {
    // Rook on a1 controls the whole first rank, including squares behind the king.
    const p = placementFromFen("4k3/8/8/8/8/8/8/r3K3 w - - 0 1");
    expect(escapeSquares(p, "w").sort()).toEqual(["d2", "e2", "f2"]);
  });

  it("flags missing pawn cover in front of a castled king (only while enemy pieces remain)", () => {
    const fen = "6k1/3q4/8/8/8/8/5P1P/6K1 w - - 0 1";
    const facts = computeFacts(fen).byLens.king;
    expect(facts.find((f) => f.kind === "pawn-shield" && f.side === "w")?.title).toMatch(/g-file/);
    const ending = computeFacts("6k1/8/8/8/8/8/5P1P/6K1 w - - 0 1").byLens.king;
    expect(ending.some((f) => f.kind === "pawn-shield")).toBe(false);
  });
});

describe("pawn structure facts", () => {
  it("classifies passed, isolated, doubled and backward pawns", () => {
    const p = placementFromFen("4k3/8/8/2p5/1pP5/1P6/1P6/4K3 w - - 0 1");
    const info = Object.fromEntries(classifyPawns(p).map((x) => [x.sq, x]));
    expect(info.b2.doubled && info.b3.doubled).toBe(true);
    expect(info.c5.passed).toBe(false);
    expect(classifyPawns(placementFromFen("4k3/8/8/3P4/8/8/8/4K3 w - - 0 1"))[0]).toMatchObject({ passed: true, isolated: true });
    // d3 is backward: its neighbours on c4/e4 are advanced and e... d4 is hit by the black c5 pawn.
    const bw = classifyPawns(placementFromFen("4k3/8/8/2p5/2P1P3/3P4/8/4K3 w - - 0 1")).find((x) => x.sq === "d3");
    expect(bw?.backward).toBe(true);
  });

  it("maps a passed pawn to its path squares", () => {
    const f = computeFacts("4k3/8/8/3P4/8/8/8/4K3 w - - 0 1").byLens.pawns.find((x) => x.kind === "passed");
    const path = f?.marks.squares.filter((s) => s.style === "flood");
    expect(path?.map((s) => s.sq)).toEqual(["d6", "d7", "d8"]);
    expect(path?.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(f?.marks.icons).toEqual([{ sq: "d8", icon: "crown", tone: "opportunity" }]);
  });
});

describe("activity, control and material", () => {
  it("recognizes outposts only where no enemy pawn can reach", () => {
    const p = placementFromFen("4k3/2p5/8/3N4/4P3/8/8/4K3 w - - 0 1");
    expect(isOutpost(p, "d5", "w")).toBe(false); // c7 pawn can come to c6
    const q = placementFromFen("4k3/8/8/3N4/4P3/8/8/4K3 w - - 0 1");
    expect(isOutpost(q, "d5", "w")).toBe(true);
  });

  it("finds open files", () => {
    expect(kinds(START_FEN, "activity").some((k) => k.startsWith("open-file"))).toBe(false);
    expect(kinds("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "activity")).toContain("open-file@a1");
  });

  it("paints the control map for the control lens only", () => {
    const facts = computeFacts(START_FEN);
    const control = marksForLenses(facts, ["control"]);
    expect(control.squares.find((s) => s.sq === "e3")?.tone).toBe("white");
    expect(control.squares.find((s) => s.sq === "e6")?.tone).toBe("black");
    expect(marksForLenses(facts, []).squares).toEqual([]);
  });

  it("only draws the focused fact when one is selected", () => {
    const facts = computeFacts("4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1");
    const focused = marksForLenses(facts, ["threats"], "enprise-e5");
    expect(focused.arrows).toEqual([{ from: "f3", to: "e5", tone: "opportunity" }]);
  });

  it("summarizes material and imbalances", () => {
    const m = materialSummary(placementFromFen("4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1"));
    expect(m.diff).toBe(6);
    expect(m.imbalances).toContain("White has the bishop pair");
  });
});

describe("tracing and plans", () => {
  it("traces attacks and defenders for a selected piece", () => {
    const ctx = makeCtx("4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1");
    const t = traceSquare(ctx, "f3");
    expect(t.lines.join(" ")).toMatch(/Attacks Ne5/);
    expect(t.marks.arrows).toContainEqual({ from: "f3", to: "e5", tone: "opportunity" });
  });

  it("proposes castling as a conditional plan and marks engine agreement", () => {
    const fen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
    const plans = findPlans(makeCtx(fen), [{ pv: ["e1g1"] }]);
    const castle = plans.find((p) => p.id === "castle-K");
    expect(castle?.evidence).toBe("engine");
    expect(castle?.conditions.every((c) => c.met)).toBe(true);
    const idea = findPlans(makeCtx(fen), []).find((p) => p.id === "castle-K");
    expect(idea?.evidence).toBe("idea");
  });
});

describe("move explanations", () => {
  it("explains a capture, and the reply, from the actual line", () => {
    const fen = "4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1";
    const why = explainMove(fen, { pv: ["f3e5", "e8e7"], eval: { kind: "cp", cp: 350 }, depth: 12 });
    expect(why?.move.san).toBe("Nxe5");
    expect(why?.move.points[0].text).toBe("Takes the knight on e5.");
    expect(why?.reply?.san).toBe("Ke7");
    expect(why?.engine.some((p) => /3 points of material ahead/.test(p.text))).toBe(true);
  });

  it("names the refutation and the cost for a worse move", () => {
    const fen = "4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1";
    const res = explainWhyNot(
      fen,
      { pv: ["f3e5"], eval: { kind: "cp", cp: 350 }, depth: 12 },
      { pv: ["e1d1", "e5f3"], eval: { kind: "cp", cp: -200 }, depth: 12 },
    );
    expect(res?.loss).toBe(550);
    expect(res?.verdict).toMatch(/Costs about 5.5 pawns compared with Nxe5/);
    expect(res?.refutation?.san).toBe("Nxf3");
  });

  it("notices when a move leaves its own piece en prise", () => {
    const fen = "4k3/8/8/4p3/8/8/8/2B1K3 w - - 0 1";
    const safe = buildVariation(fen, ["c1g5"]);
    expect(staticMovePoints(safe.moves[0]).some((p) => p.tone === "danger")).toBe(false);
    const hang = buildVariation(fen, ["c1f4"]);
    expect(staticMovePoints(hang.moves[0]).map((p) => p.text)).toContain("The bishop on f4 can be taken by the e5 pawn.");
  });
});

describe("engine threat (null move)", () => {
  // Black to move; White's queen on h5 and bishop on c4 aim at f7.
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";

  it("reports a threat only when the opponent's free move gains a lot", async () => {
    const { threatFact } = await import("./engineFacts");
    const f = threatFact(fen, { kind: "cp", cp: 30 }, { pv: ["h5f7"], eval: { kind: "mate", moves: 1, winner: "w" }, depth: 12 });
    expect(f?.title).toBe("White threatens mate, starting with Qxf7#.");
    expect(f?.marks.arrows[0]).toEqual({ from: "h5", to: "f7", tone: "danger" });
    expect(f?.evidence).toBe("engine");
    expect(threatFact(fen, { kind: "cp", cp: 30 }, { pv: ["h5f7"], eval: { kind: "cp", cp: 90 }, depth: 12 })).toBeNull();
  });
});

describe("quiet move explanations", () => {
  it("explains prophylaxis: a3 takes b4 away from Black's pieces", () => {
    const fen = "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10";
    const v = buildVariation(fen, ["a2a3"]);
    const texts = staticMovePoints(v.moves[0]).map((p) => p.text);
    expect(texts.join(" ")).toMatch(/Takes b4 away from (the knight on c6|the bishop on e7)/);
  });

  it("explains a move that opens a line for another piece, without counting squares", () => {
    const v = buildVariation("4k3/8/8/8/8/8/3P4/2B1K3 w - - 0 1", ["d2d4"]);
    const texts = staticMovePoints(v.moves[0]).map((p) => p.text);
    expect(texts).toContain("Opens a line for the bishop on c1.");
    expect(texts.join(" ")).not.toMatch(/safe squares/);
  });
});

describe("piece activity and pins judged by what they do", () => {
  // Black's pawn on f7 is pinned by Bb3, but f6 holds Black's own knight: the pin costs nothing.
  const FEN = "r2q1rk1/1b2bppp/p2p1n2/1p2p3/4P3/1BN2N2/PPP2PPP/R2Q1RK1 w - - 0 11";
  const all = (fen: string) => Object.values(computeFacts(fen).byLens).flat();

  it("leaves out a pin that costs nothing", () => {
    expect(makeCtx(FEN).pins.some((p) => p.pinned === "f7")).toBe(true);
    expect(all(FEN).some((f) => f.kind.startsWith("pin-") && f.anchor === "f7")).toBe(false);
  });

  it("keeps a pin that takes squares away, and says which", () => {
    // Ruy Lopez after 3...d6: the knight on c6 is pinned to the king by Bb5.
    const pin = all("r1bqkbnr/ppp2ppp/2np4/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4").find((f) => f.kind === "pin-absolute" && f.anchor === "c6");
    expect(pin?.detail).toMatch(/illegal/);
  });

  it("doesn't call a pinning bishop passive, but finds the bishop boxed in by its own pieces", () => {
    const facts = all(FEN);
    expect(facts.some((f) => (f.kind === "worst-piece" || f.kind === "restricted") && f.anchor === "b3")).toBe(false);
    const worst = facts.find((f) => f.kind === "worst-piece" && f.side === "b");
    expect(worst?.anchor).toBe("e7");
    expect(worst?.detail).toMatch(/^The knight on f6 and the pawn on d6 are in its way/);
  });
});
