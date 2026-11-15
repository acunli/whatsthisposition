import { describe, expect, it } from "vitest";
import type { Evaluation } from "../engine/score";
import { buildCommentary, type Commentary } from "./index";
import { features, materialWords } from "./features";
import { findStructures } from "./structures";

/** The same position with the colours swapped (board flipped top to bottom). */
function mirror(fen: string): string {
  const [rows, turn, castling, ep, half, full] = fen.split(" ");
  const swap = (s: string) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
  const rights = castling === "-" ? "-" : [...swap(castling)].sort((a, b) => "KQkq".indexOf(a) - "KQkq".indexOf(b)).join("");
  const epSq = ep === "-" ? "-" : `${ep[0]}${9 - Number(ep[1])}`;
  return [rows.split("/").reverse().map(swap).join("/"), turn === "w" ? "b" : "w", rights, epSq, half, full].join(" ");
}

const cp = (n: number): Evaluation => ({ kind: "cp", cp: n });
const other = (c: "w" | "b") => (c === "w" ? "b" : "w");

const CARLSBAD = "r1bqrnk1/pp2bppp/2p2n2/3p2B1/3P4/2NBPN2/PPQ2PPP/R4RK1 w - - 9 11";
const KID = "r1bq1rk1/pppnn1bp/3p2p1/3Ppp2/2P1P3/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 11";
const FRENCH = "r1b1kbnr/pp3ppp/1qn1p3/2ppP3/3P4/2P2N2/PP2BPPP/RNBQK2R b KQkq - 3 6";
const IQP = "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10";
const YUGOSLAV = "r2q1rk1/pp1bppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/2KR1B1R w - - 5 10";
const NAJDORF = "rnbqkb1r/1p3ppp/p2p1n2/4p3/4P3/1NN5/PPP2PPP/R1BQKB1R w KQkq - 0 7";
const HANGING = "r2q1rk1/pb2bppp/1p2pn2/8/2PP4/5N2/PB2BPPP/R2Q1RK1 b - - 0 13";
const STONEWALL = "rnbq1rk1/pp4pp/2pbpn2/3p1p2/2PP4/5NP1/PP2PPBP/RNBQ1RK1 w - - 0 8";
const STUCK = "r1bqk2r/pppp1ppp/2n2n2/2b5/2B1P3/5N2/PPP2PPP/RNBQ1RK1 b - - 0 10";
const ROOK_END = "8/5pk1/6p1/1R5p/7P/6P1/r4PK1/8 w - - 0 40";
const SAMPLES = [CARLSBAD, KID, FRENCH, IQP, YUGOSLAV, NAJDORF, HANGING, STONEWALL, STUCK, ROOK_END];

const typeIds = (c: Commentary) => c.types.map((t) => t.id.replace(/-(w|b)$/, "")).sort();
const planIds = (c: Commentary, side: "w" | "b") => c.sides[side].plans.map((p) => p.id.replace(/[a-h][1-8]/g, "sq")).sort();
const structure = (fen: string) => findStructures(features(fen)).map((s) => `${s.id}:${s.side}`);

describe("commentary: the kind of position", () => {
  it("names the pawn structures players know", () => {
    expect(structure(CARLSBAD)).toContain("carlsbad:w");
    expect(structure(KID)).toContain("chain:w");
    expect(structure(FRENCH)).toContain("chain:w");
    expect(structure(IQP)).toContain("iqp:w");
    expect(structure(YUGOSLAV)).toContain("sicilian:w");
    expect(structure(HANGING)).toContain("hanging:w");
    expect(structure(STONEWALL)).toContain("stonewall:b");
  });

  it("reads a locked chain's direction: play goes where each chain points", () => {
    const kid = findStructures(features(KID)).find((s) => s.id === "chain")!.chain!;
    expect(kid.w.wing).toBe("queenside");
    expect(kid.b.wing).toBe("kingside");
    const french = findStructures(features(FRENCH)).find((s) => s.id === "chain")!.chain!;
    expect(french.w.wing).toBe("kingside");
    expect(french.b.wing).toBe("queenside");
    // The lever attacks the pawn that blocks the head of the chain.
    expect(kid.w.target).toBe("d6");
    expect(kid.b.target).toBe("e4");
    expect(french.b.target).toBe("d4");
  });

  it("tells the phases and the endgames apart", () => {
    expect(buildCommentary(FRENCH).phase).toBe("opening");
    expect(buildCommentary(CARLSBAD).phase).toBe("middlegame");
    expect(buildCommentary(ROOK_END).types[0].id).toBe("eg-rook");
    expect(buildCommentary("8/8/4k3/8/2PK4/8/8/8 w - - 0 1").types[0].id).toBe("eg-pawn");
    expect(buildCommentary("8/pp3k2/4n3/8/3B4/8/PP3K2/8 b - - 0 30").types[0].id).toBe("eg-bn");
    expect(buildCommentary("8/pp3k2/4b3/8/3B4/8/PP3K2/8 w - - 0 30").types[0].id).toBe("eg-ocb");
    expect(buildCommentary("k1r5/p7/2q5/8/2p5/1Q4PP/P4P2/1R4K1 w - - 0 41").types[0].id).toBe("eg-heavy");
    expect(buildCommentary("r4rk1/ppp2ppp/2n2n2/3p4/3P4/2N2N2/PPP2PPP/R4RK1 w - - 0 14").phase).toBe("queenless");
  });

  it("sees the kings: opposite wings, and a king that can no longer castle", () => {
    expect(buildCommentary(YUGOSLAV).types.map((t) => t.id)).toContain("kings-opposite");
    const stuck = buildCommentary(STUCK).types.find((t) => t.group === "kings")!;
    expect(stuck.side).toBe("b");
    expect(stuck.name).toBe("King stuck in the centre");
  });

  it("says the same about a position whichever colour has it", () => {
    for (const fen of SAMPLES) {
      const a = buildCommentary(fen);
      const b = buildCommentary(mirror(fen));
      expect(typeIds(b), fen).toEqual(typeIds(a));
      for (const side of ["w", "b"] as const) {
        expect(planIds(b, other(side)), fen).toEqual(planIds(a, side));
        expect(b.sides[other(side)].likes.map((p) => p.theme), fen).toEqual(a.sides[side].likes.map((p) => p.theme));
        expect(b.sides[other(side)].dislikes.map((p) => p.theme), fen).toEqual(a.sides[side].dislikes.map((p) => p.theme));
      }
    }
  });
});

describe("commentary: material", () => {
  const words = (fen: string) => materialWords(features(fen));
  it("says it the way a player would", () => {
    expect(words(CARLSBAD)).toBeNull();
    expect(words("4k3/pppp4/8/8/8/8/PPPPP3/4K3 w - - 0 1")).toMatchObject({ side: "w", text: "a pawn up", mixed: false });
    expect(words("r3k3/pppp4/8/8/8/8/PPPP4/2B1K3 w - - 0 1")).toMatchObject({ side: "b", text: "the exchange up", mixed: true });
    expect(words("r3k3/ppp5/8/8/8/8/PPPP4/2B1K3 w - - 0 1")).toMatchObject({ side: "b", text: "the exchange for a pawn" });
    expect(words("4k3/pppp4/8/8/8/8/PPPP4/2B1K3 w - - 0 1")).toMatchObject({ side: "w", text: "a piece up" });
    expect(words("4k3/ppppp3/8/8/8/8/PPP5/2N1K3 w - - 0 1")).toMatchObject({ side: "w", text: "a piece for two pawns" });
    expect(words("2n1k3/ppppp3/8/8/8/8/PPPP4/3QK3 w - - 0 1")).toMatchObject({ side: "w", text: "a queen for a knight and a pawn" });
    // A bishop for a knight is not a difference in material.
    expect(words("2n1k3/pppp4/8/8/8/8/PPPP4/2B1K3 w - - 0 1")).toBeNull();
  });

  it("counts the pieces after the exchange the engine's line starts with", () => {
    // Black has just taken a knight on c3: a piece up on the board, level after bxc3.
    const fen = "r2qk2r/ppp2pp1/2n1pn1p/3p4/2PP3B/2bQPN2/PP3PPP/R4RK1 w kq - 0 11";
    expect(buildCommentary(fen).sides.b.likes.map((p) => p.id)).toContain("b-material");
    const settled = buildCommentary(fen, { lines: [{ pv: ["b2c3", "d5c4", "d3c4"], eval: cp(94) }] });
    expect(settled.sides.b.likes.map((p) => p.id)).not.toContain("b-material");
    expect(settled.types.map((t) => t.id)).not.toContain("compensation");
    expect(settled.story.join(" ")).toMatch(/takes back/);
  });
});

describe("commentary: plans", () => {
  const plans = (fen: string, side: "w" | "b") => buildCommentary(fen).sides[side].plans;

  it("gives each structure its plans, to the side they belong to", () => {
    expect(plans(CARLSBAD, "w").map((p) => p.id)).toContain("minority-attack");
    expect(plans(CARLSBAD, "b").map((p) => p.id)).toContain("carlsbad-kingside");
    expect(plans(CARLSBAD, "b").find((p) => p.id === "carlsbad-kingside")!.why).toMatch(/e4/);
    expect(plans(IQP, "w").map((p) => p.id)).toContain("iqp-activity");
    expect(plans(IQP, "b").map((p) => p.id)).toContain("iqp-blockade");
    expect(plans(HANGING, "w").map((p) => p.id)).toContain("hanging-advance");
    expect(plans(HANGING, "b").map((p) => p.id)).toContain("hanging-pressure");
    expect(plans(YUGOSLAV, "w")[0]).toMatchObject({ id: "pawn-storm", category: "attack" });
    expect(plans(YUGOSLAV, "b").map((p) => p.id)).toEqual(expect.arrayContaining(["pawn-storm", "sicilian-c-file"]));
  });

  it("sends each side to the wing its chain points at, and calls it an attack where the king lives", () => {
    const w = plans(KID, "w").find((p) => p.id === "chain-wing")!;
    const b = plans(KID, "b").find((p) => p.id === "chain-wing")!;
    expect(w).toMatchObject({ category: "wing", title: "Play on the queenside" });
    expect(b).toMatchObject({ category: "attack", title: "Attack on the kingside" });
    expect(w.keySan).toBe("c5");
  });

  it("puts the king first when it is in trouble", () => {
    expect(plans(STUCK, "b")[0]).toMatchObject({ id: "king-by-hand", category: "defend" });
    expect(plans(STUCK, "w")[0]).toMatchObject({ id: "open-centre-on-king", category: "attack" });
  });

  it("uses the king as a piece in an endgame, towards the pawns", () => {
    expect(plans(ROOK_END, "w").map((p) => p.title)).toContain("Bring the king up to the kingside pawns");
  });

  it("marks the plans the engine's lines actually play, and leads with them", () => {
    const c = buildCommentary(KID, { lines: [{ pv: ["b2b4", "a7a5", "f3g5"], eval: cp(29) }, { pv: ["e4f5", "e7f5"], eval: cp(27) }] });
    const first = c.sides.w.plans[0];
    expect(first.id).toBe("chain-wing");
    expect(first.engine).toMatchObject({ follows: "main" });
    expect(first.engine!.note).toMatch(/11\.b4/);
    expect(c.story.join(" ")).toMatch(/11\.b4 belongs to the plan/);
  });

  it("drops the plans when the game is decided", () => {
    const mate = buildCommentary("4q1k1/1R5p/p5p1/n1P5/4P3/2Q4P/PP3PP1/6K1 w - - 3 39", { lines: [{ pv: ["c3g7"], eval: { kind: "mate", moves: 1, winner: "w" } }] });
    expect(mate.sides.w.plans).toEqual([]);
    expect(mate.sides.b.plans).toEqual([]);
    expect(mate.story[0]).toMatch(/mate in 1/);
    const won = buildCommentary("3r1rk1/p1p2pp1/1p2p2p/3pP1n1/3P4/2P5/P2Q1PPP/1R2R1K1 w - - 1 19", { lines: [{ pv: ["e1e3", "c7c5"], eval: cp(582) }] });
    expect(won.types.map((t) => t.id)).toContain("won");
    expect(won.sides.b.plans.every((p) => p.category === "defend")).toBe(true);
  });

  it("never starts a sentence with a capitalised move or square", () => {
    for (const fen of SAMPLES) {
      const c = buildCommentary(fen);
      const text = [...c.story, ...c.types.map((t) => t.meaning), ...(["w", "b"] as const).flatMap((s) => [...c.sides[s].likes, ...c.sides[s].dislikes].map((p) => p.text).concat(c.sides[s].plans.flatMap((p) => [p.why, p.risk ?? "", ...p.steps.map((x) => x.text)])))];
      for (const t of text) expect(t, t).not.toMatch(/(^|[.:] )[A-H][1-8]\b/);
    }
  });
});
