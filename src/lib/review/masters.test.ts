import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import openings from "@/data/openings.json";
import { START_FEN } from "../chess/fen";
import type { Evaluation } from "../engine/score";
import { makeBook } from "./book";
import type { PositionAnalysis } from "./classify";
import { explainOpening, explainReviewMove } from "./explain";
import { isTheory, mainLine, parseMasters, readMasters, type MasterEntry } from "./masters";
import { parseGame } from "./pgn";
import { hash53 } from "./positionKey";
import { classifyGame } from "./review";

const FILES = "abcdefgh";
const sq = (s: string) => FILES.indexOf(s[0]) + 8 * (Number(s[1]) - 1);
const PROMO: Record<string, number> = { "": 0, n: 1, b: 2, r: 3, q: 4 };

/** Writes a v2 book the way scripts/build-book.mjs does. */
function encode(entries: { fen: string; total: number; moves: { uci: string; count: number; white: number; draw: number }[] }[]): ArrayBuffer {
  const rows = entries
    .map((e) => {
      const k = hash53(e.fen.split(" ").slice(0, 2).join(" "));
      return { ...e, lo: k % 4294967296, hi: Math.floor(k / 4294967296) & 0xffff };
    })
    .sort((a, b) => a.lo + a.hi * 4294967296 - (b.lo + b.hi * 4294967296));
  const size = 16 + rows.reduce((n, r) => n + 11 + r.moves.length * 7, 0);
  const v = new DataView(new ArrayBuffer(size));
  "WTPB".split("").forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint8(4, 2);
  v.setUint8(5, 32);
  v.setUint16(6, 2000, true);
  v.setUint32(8, 1234, true);
  v.setUint32(12, rows.length, true);
  let o = 16;
  for (const r of rows) {
    v.setUint32(o, r.lo, true);
    v.setUint16(o + 4, r.hi, true);
    v.setUint32(o + 6, r.total, true);
    v.setUint8(o + 10, r.moves.length);
    o += 11;
    for (const m of r.moves) {
      v.setUint16(o, (sq(m.uci.slice(0, 2)) << 9) | (sq(m.uci.slice(2, 4)) << 3) | PROMO[m.uci[4] ?? ""], true);
      v.setUint16(o + 2, m.count & 0xffff, true);
      v.setUint8(o + 4, m.count >> 16);
      v.setUint8(o + 5, m.white);
      v.setUint8(o + 6, m.draw);
      o += 7;
    }
  }
  return v.buffer;
}

// 1.d4 Nf6 2.c4 d5: the named lines stop here; strong players go on with 3.cxd5 or 3.Nc3.
const LINE = "1. d4 Nf6 2. c4 d5 3. Nc3 a6 4. cxd5 *";
const g = parseGame(LINE);
const at = (i: number) => g.moves[i].fenBefore;
const BOOK_ENTRIES = [
  { fen: START_FEN, total: 900_000, moves: [{ uci: "d2d4", count: 400_000, white: 40, draw: 30 }, { uci: "e2e4", count: 300_000, white: 38, draw: 28 }] },
  { fen: at(1), total: 300_000, moves: [{ uci: "g8f6", count: 200_000, white: 40, draw: 30 }] },
  { fen: at(2), total: 150_000, moves: [{ uci: "c2c4", count: 120_000, white: 41, draw: 30 }] },
  { fen: at(3), total: 100_000, moves: [{ uci: "e7e6", count: 40_000, white: 40, draw: 32 }, { uci: "d7d5", count: 1_000, white: 45, draw: 25 }] },
  { fen: at(4), total: 900, moves: [{ uci: "c4d5", count: 800, white: 47, draw: 25 }, { uci: "b1c3", count: 90, white: 50, draw: 20 }] },
  { fen: at(5), total: 90, moves: [{ uci: "d5c4", count: 60, white: 45, draw: 25 }, { uci: "c7c6", count: 20, white: 40, draw: 40 }] },
  // After 3…dxc4: theory goes on with 4.e4.
  { fen: "rnbqkb1r/ppp1pppp/5n2/8/2pP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4", total: 60, moves: [{ uci: "e2e4", count: 40, white: 55, draw: 20 }] },
];
const BOOK = encode(BOOK_ENTRIES);
const flat = (n: number, e: Evaluation = { kind: "cp", cp: 20 }): PositionAnalysis[] => Array.from({ length: n }, () => ({ eval: e, depth: 14, lines: [{ multipv: 1, depth: 14, eval: e, pv: [] }] }));
const named = makeBook(openings as { book: string[]; names: Record<string, string> });

describe("master book", () => {
  const m = parseMasters(BOOK);

  it("parses positions, moves (castling and promotions too) and results", () => {
    expect(m.games).toBe(1234);
    expect(m.positions).toBe(7);
    const e = m.get(START_FEN)!;
    expect(e.total).toBe(900_000);
    expect(e.moves[0]).toEqual({ uci: "d2d4", count: 400_000, white: 40, draw: 30, black: 30 });
    expect(m.get("8/8/8/8/8/8/8/K6k w - - 0 1")).toBeNull();
    const special = parseMasters(encode([{ fen: START_FEN, total: 10, moves: [{ uci: "e1g1", count: 5, white: 50, draw: 0 }, { uci: "a7a8q", count: 5, white: 100, draw: 0 }] }]));
    expect(special.get(START_FEN)!.moves.map((x) => x.uci)).toEqual(["e1g1", "a7a8q"]);
  });

  it("reads a gzipped book", async () => {
    const z = gzipSync(new Uint8Array(BOOK));
    const book = await readMasters(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));
    expect(book.get(START_FEN)?.total).toBe(900_000);
  });

  it("counts a move as theory when strong players really choose it", () => {
    const mv = (uci: string, count: number) => ({ uci, count, white: 0, draw: 0, black: 0 });
    const e: MasterEntry = { total: 10_000, moves: [mv("a", 150), mv("b", 30), mv("c", 20)] };
    expect(isTheory(e, "a")).toBeTruthy(); // 1.5%
    expect(isTheory(e, "b")).toBeTruthy(); // 30 games, 0.3%
    expect(isTheory(e, "c")).toBeNull(); // 20 games, 0.2%: too rare to be theory
    expect(isTheory({ total: 100_000, moves: [mv("d", 90)] }, "d")).toBeNull(); // 90 games but 0.09%
    expect(isTheory(e, "zz")).toBeNull();
  });

  it("follows the most played moves as the main line", () => {
    expect(mainLine(m, at(5), 6)).toEqual(["d5c4", "e2e4"]);
  });

  it("makes the book go on past the named lines, with statistics", () => {
    const pos = flat(g.moves.length + 1);
    const short = classifyGame(g, pos, named);
    expect(short.bookUntil).toBe(3);
    const r = classifyGame(g, pos, makeBook(openings as never, m));
    expect(r.bookUntil).toBe(4); // 3.Nc3 is theory (10% of 900 games)
    expect(r.moves[4].cls).toBe("book");
    expect(r.moves[4].theory?.played?.count).toBe(90);
    expect(r.moves[4].theory?.options.map((o) => o.san)).toEqual(["cxd5", "Nc3"]);
    // 3…a6 left the book; it carries what strong players play instead.
    expect(r.moves[5].cls).not.toBe("book");
    expect(r.moves[5].theory?.options[0]).toMatchObject({ san: "dxc4", line: ["e2e4"] });
    expect(r.masters).toEqual({ games: 1234, minElo: 2000 });
  });

  it("doesn't call a master move book when the engine says it's a mistake", () => {
    const pos = flat(g.moves.length + 1);
    pos[5] = { eval: { kind: "cp", cp: -400 }, depth: 14, lines: [{ multipv: 1, depth: 14, eval: { kind: "cp", cp: -400 }, pv: [] }] };
    const r = classifyGame(g, pos, makeBook(openings as never, m));
    expect(r.bookUntil).toBe(3);
  });

  it("explains book moves, the move that left the book, and the opening as a whole", () => {
    const r = classifyGame(g, flat(g.moves.length + 1), makeBook(openings as never, m));
    const book = explainReviewMove(r.moves[4], r.moves[3]);
    const text = book.opening!.map((p) => p.text).join(" ");
    expect(text).toMatch(/reached this position in 900 games and chose 3\.Nc3 in 10% of them/);
    expect(text).toMatch(/Other choices here: 3\.cxd5 \(89%\)/);
    expect(book.opening!.find((p) => p.text.startsWith("Other"))!.lines![0]).toMatchObject({ pv: ["c4d5"], label: "3.cxd5" });

    const left = explainReviewMove(r.moves[5], r.moves[4]);
    expect(left.opening![0].text).toMatch(/This leaves opening theory\. In 90 games, strong players played 3…dxc4 \(67%\) or 3…c6 \(22%\)/);

    const o = explainOpening(r)!;
    expect(o.leftPly).toBe(6);
    const all = o.points.map((p) => p.text).join(" ");
    expect(all).toMatch(/followed opening theory up to 3\.Nc3: 5 moves in all/);
    expect(all).toMatch(/Black left the book with 3…a6/);
    expect(all).toMatch(/The main line goes on 3…dxc4 4\.e4/);
    expect(o.points.find((p) => p.text.startsWith("The main line"))!.line).toMatchObject({ pv: ["d5c4", "e2e4"] });
  });

  it("says theory ran out, rather than blaming the next move, when the data stops", () => {
    // The same book without the position after 3.Nc3: too few games reached it.
    const thin = BOOK_ENTRIES.filter((e) => e.fen !== at(5));
    const r = classifyGame(g, flat(g.moves.length + 1), makeBook(openings as never, parseMasters(encode(thin))));
    expect(r.bookUntil).toBe(4);
    const all = explainOpening(r)!.points.map((p) => p.text).join(" ");
    expect(all).toMatch(/Theory runs out after 3\.Nc3: too few games/);
    expect(all).not.toMatch(/left the book/);
  });
});
