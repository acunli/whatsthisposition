/**
 * Book coverage: how many plies of each game count as opening theory, with the named
 * lines alone and with the master book. No engine needed.
 *
 * Skipped unless EVAL_GAMES points at a games file (scripts/eval/fetch-games.mjs):
 *   EVAL_GAMES=scripts/eval/out/games.json [EVAL_N=200] [EVAL_SHOW=12] [EVAL_BOOK=other.bin] [EVAL_OUT=…] \
 *     npx vitest run src/lib/eval/book-coverage.test.ts
 *   less scripts/eval/out/book-coverage.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import openings from "@/data/openings.json";
import { makeBook, type OpeningBook } from "../review/book";
import { readMasters } from "../review/masters";
import type { PositionAnalysis } from "../review/classify";
import { parseGame } from "../review/pgn";
import { classifyGame } from "../review/review";
import type { SavedGame } from "./nodeEngine";

const env = process.env;

it.skipIf(!env.EVAL_GAMES)("book length with and without the master book", async () => {
  const bin = readFileSync(env.EVAL_BOOK ?? "public/data/masters-book.bin.gz");
  const masters = await readMasters(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const named = makeBook(openings as never);
  const both = makeBook(openings as never, masters);
  const games = (JSON.parse(readFileSync(env.EVAL_GAMES!, "utf8")) as SavedGame[]).slice(0, Number(env.EVAL_N ?? 200));
  const flat: PositionAnalysis = { lines: [], eval: { kind: "cp", cp: 0 }, depth: 1 };
  const plies = (book: OpeningBook, pgn: string) => {
    const g = parseGame(pgn);
    // Only the opening matters: positions after ply 40 stay unanalysed, so classifying stops there.
    const pos = Array(g.moves.length + 1).fill(null).map((_, i) => (i <= 40 ? flat : null));
    return { r: classifyGame(g, pos, book), g };
  };
  const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1);
  const a: number[] = [];
  const b: number[] = [];
  const lines: string[] = [];
  for (const sg of games) {
    const x = plies(named, sg.pgn);
    const y = plies(both, sg.pgn);
    a.push(x.r.bookUntil + 1);
    b.push(y.r.bookUntil + 1);
    if (lines.length < Number(env.EVAL_SHOW ?? 12)) {
      const left = y.r.moves[y.r.bookUntil + 1];
      const opts = left?.theory?.options.map((o) => `${o.san} ${Math.round((100 * o.count) / left.theory!.games)}%`).join(", ");
      lines.push(
        `${String(x.r.bookUntil + 1).padStart(2)} → ${String(y.r.bookUntil + 1).padStart(2)} plies  ${y.g.moves.slice(0, y.r.bookUntil + 1).map((m) => m.san).join(" ")}` +
          (left ? `  | left with ${left.move.san}${opts ? ` (masters: ${opts})` : ""}` : "") +
          `  [${y.r.opening?.name ?? "—"}]`,
      );
    }
  }
  const hist = (xs: number[]) => {
    const h: Record<number, number> = {};
    for (const n of xs) h[n] = (h[n] ?? 0) + 1;
    return JSON.stringify(h);
  };
  const report = [
    `${games.length} games, master book ${masters.positions} positions from ${masters.games} games`,
    `mean book length: named lines ${mean(a)} plies, with master book ${mean(b)} plies`,
    `named:   ${hist(a)}`,
    `masters: ${hist(b)}`,
    "",
    ...lines,
  ].join("\n");
  writeFileSync(env.EVAL_OUT ?? "scripts/eval/out/book-coverage.txt", report);
}, 600_000);
