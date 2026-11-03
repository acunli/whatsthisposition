import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { MasterEntry, MastersBook } from "../review/masters";
import { bookKey } from "../review/positionKey";
import { buildCatalog, numbered, openingSlug, openingSummary, type OpeningLine } from "./catalog";

/** A master book from a few positions, given by the moves that reach them. */
function bookOf(entries: [moves: string, entry: MasterEntry][]): MastersBook {
  const map = new Map<string, MasterEntry>();
  for (const [moves, e] of entries) {
    const c = new Chess();
    for (const s of moves.split(" ").filter(Boolean)) c.move(s);
    map.set(bookKey(c.fen()), e);
  }
  return { games: 1000, minElo: 2300, maxPly: 30, positions: map.size, get: (fen) => map.get(bookKey(fen)) ?? null };
}

const LINES: OpeningLine[] = [
  ["B20", "Sicilian Defense", "e4 c5"],
  ["B27", "Sicilian Defense: Hyperaccelerated Dragon", "e4 c5 Nf3 g6"],
  ["B50", "Sicilian Defense", "e4 c5 Nf3 d6"],
  ["B90", "Sicilian Defense: Najdorf Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"],
  ["C20", "King's Pawn Game", "e4 e5"],
];

const BOOK = bookOf([
  ["e4 c5", { total: 900, moves: [{ uci: "g1f3", count: 700, white: 40, draw: 30, black: 30 }, { uci: "b1c3", count: 200, white: 30, draw: 40, black: 30 }] }],
  ["e4 c5 Nf3 g6", { total: 60, moves: [{ uci: "d2d4", count: 60, white: 50, draw: 30, black: 20 }] }],
  ["e4 c5 Nf3 d6", { total: 20, moves: [{ uci: "d2d4", count: 20, white: 50, draw: 30, black: 20 }] }],
  ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", { total: 300, moves: [{ uci: "c1e3", count: 150, white: 45, draw: 30, black: 25 }] }],
  ["e4 e5", { total: 10, moves: [] }],
]);

describe("the opening catalog", () => {
  const cat = buildCatalog(LINES, BOOK);

  it("makes a page for each name strong players reach often enough, from its most played line", () => {
    expect(cat.all.map((o) => o.slug)).toEqual(["sicilian-defense", "sicilian-defense-najdorf-variation", "sicilian-defense-hyperaccelerated-dragon"]);
    expect(cat.bySlug.get("sicilian-defense")!.sans).toEqual(["e4", "c5"]);
  });

  it("scores the opening over the moves played and names where they lead", () => {
    const s = cat.bySlug.get("sicilian-defense")!;
    expect(s.score).toEqual({ white: 37.8, draw: 32.2, black: 30 });
    expect(s.next[0]).toMatchObject({ san: "Nf3", share: 77.8, games: 700 });
    expect(s.next[0].to).toBeUndefined(); // 2.Nf3 alone isn't a named opening here
  });

  it("links an opening to the one it branches from and back", () => {
    expect(cat.bySlug.get("sicilian-defense-najdorf-variation")!.parent).toBe("sicilian-defense");
    expect(cat.bySlug.get("sicilian-defense")!.children).toEqual(["sicilian-defense-najdorf-variation", "sicilian-defense-hyperaccelerated-dragon"]);
  });

  it("groups openings by family", () => {
    expect(cat.families.map((f) => [f.name, f.openings.length])).toEqual([["Sicilian Defense", 3]]);
  });

  it("writes the same kind of sentence for every opening", () => {
    expect(openingSummary(cat.bySlug.get("sicilian-defense-najdorf-variation")!)).toBe(
      "Sicilian Defense: Najdorf Variation (B90) starts 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6. In 300 games between strong players, White wins 45%, 30% are drawn and Black wins 25%; the most played move is 6.Be3 (50%).",
    );
  });

  it("makes plain slugs and numbered lines", () => {
    expect(openingSlug("Sicilian Defense: Najdorf Variation, English Attack")).toBe("sicilian-defense-najdorf-variation-english-attack");
    expect(openingSlug("King's Indian Attack: Réti–Smyslov Variation")).toBe("kings-indian-attack-reti-smyslov-variation");
    expect(numbered(["e4", "e5", "Nf3"])).toBe("1.e4 e5 2.Nf3");
  });
});
