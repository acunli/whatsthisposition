/**
 * Accuracy data: reviews every game that Chess.com has reviewed and saves, per
 * player, Chess.com's accuracy next to ours plus each move's expected score before
 * and after. scripts/eval/fit-accuracy.py fits and cross-checks the calibration
 * in src/lib/review/accuracy.ts from this file.
 *
 * Skipped unless EVAL_GAMES points at a games file (scripts/eval/fetch-games.mjs):
 *   EVAL_GAMES=scripts/eval/out/games.json [EVAL_DEPTH=14] [EVAL_N=46] [EVAL_OUT=…] \
 *     npx vitest run src/lib/eval/accuracy-data.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import openings from "@/data/openings.json";
import { gameAccuracy } from "../review/accuracy";
import { makeBook } from "../review/book";
import { parseGame } from "../review/pgn";
import { analysePositions, classifyGame, tally } from "../review/review";
import { nodeSearcher, type SavedGame } from "./nodeEngine";

const env = process.env;

it.skipIf(!env.EVAL_GAMES)("save accuracy data next to Chess.com's numbers", async () => {
  const search = await nodeSearcher();
  const book = makeBook(openings as never);
  const games = (JSON.parse(readFileSync(env.EVAL_GAMES!, "utf8")) as SavedGame[]).filter((g) => g.accuracies).slice(0, Number(env.EVAL_N ?? 46));
  const rows: unknown[] = [];
  for (const g of games) {
    const pg = parseGame(g.pgn);
    const r = classifyGame(pg, await analysePositions(pg, [search], { depth: Number(env.EVAL_DEPTH ?? 14) }), book);
    rows.push({
      url: g.url,
      cc: g.accuracies,
      ours: gameAccuracy(r.moves),
      tally: tally(r.moves),
      moves: r.moves.map((m) => ({ c: m.move.color, before: m.before, after: m.after, cls: m.cls })),
    });
  }
  writeFileSync(env.EVAL_OUT ?? "scripts/eval/out/accuracy-data.json", JSON.stringify(rows));
}, 7_200_000);
