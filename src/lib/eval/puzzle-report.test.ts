/**
 * Puzzle report: reviews real games the way the puzzle maker does and prints every mistake
 * of one player with how it was classified, the puzzle made from it (or why none was),
 * and the weaknesses they add up to. Read it against the games: is the weakness named
 * right, does the puzzle have one answer, does the sentence say what happens?
 *
 * Skipped unless EVAL_GAMES points at a games file (scripts/eval/fetch-games.mjs):
 *   EVAL_GAMES=scripts/eval/out/games.json EVAL_PLAYER=Ay7u [EVAL_OUT=…] [EVAL_SKIP=0] [EVAL_N=6] [EVAL_DEPTH=12] \
 *     npx vitest run src/lib/eval/puzzle-report.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import openings from "@/data/openings.json";
import { fromGame, sideOf } from "../puzzles/build";
import { makeSet } from "../puzzles/profile";
import { makeBook } from "../review/book";
import { parseGame } from "../review/pgn";
import { classifyGame, runReview } from "../review/review";
import { nodeSearcher, type SavedGame } from "./nodeEngine";

const env = process.env;

it.skipIf(!env.EVAL_GAMES)(
  "write the puzzle report",
  async () => {
    const search = await nodeSearcher();
    const book = makeBook(openings as never);
    const depth = Number(env.EVAL_DEPTH ?? 12);
    const who = env.EVAL_PLAYER ?? "Ay7u";
    const games = (JSON.parse(readFileSync(env.EVAL_GAMES!, "utf8")) as SavedGame[]).filter((g) => g.time_class !== "bullet").slice(Number(env.EVAL_SKIP ?? 0), Number(env.EVAL_SKIP ?? 0) + Number(env.EVAL_N ?? 6));
    const out: string[] = [];
    const parts = [];
    for (const [i, sg] of games.entries()) {
      const g = parseGame(sg.pgn);
      const player = sideOf(g, who);
      if (!player) continue;
      const positions = await runReview(g, [search], { depth, verifyDepth: depth + 4, book: Promise.resolve(book) });
      const review = classifyGame(g, positions, book);
      const part = fromGame({ game: g, review, positions, player, index: i, url: sg.url });
      parts.push(part);
      out.push(`\n######## ${g.white} vs ${g.black} (${g.result}) as ${player}  ${sg.url}`);
      for (const s of part.slips) {
        const c = review.moves[s.ply - 1];
        const p = part.puzzles.find((x) => x.id === s.puzzle);
        out.push(`  ${c.move.moveNumber}${c.move.color === "w" ? "." : "…"}${c.move.san} [${c.cls}] loss ${c.loss.toFixed(2)} → ${s.key} (${s.phase}${s.rushed ? ", rushed" : ""})`);
        if (p) out.push(`      PUZZLE ${p.task} · ${p.solver} to move · ${p.fen}\n      answer: ${p.point}\n      ${p.inGame}`);
        else out.push(`      no puzzle (no single clear answer)`);
      }
    }
    const set = makeSet(parts, who, 0);
    out.push(`\n================ ${set.games} games, ${set.moves} moves by ${who}, ${set.slips.length} mistakes, ${set.puzzles.length} puzzles`);
    for (const w of set.weaknesses) out.push(`  ${w.name}: ${w.count} in ${w.games} games, cost ${w.loss.toFixed(2)}, ${w.puzzles.length} puzzles\n      ${w.text}\n      ${w.advice}`);
    out.push(`\norder: ${set.puzzles.map((p) => p.key).join(" | ")}`);
    const file = env.EVAL_OUT ?? "scripts/eval/out/puzzle-report.txt";
    writeFileSync(file, out.join("\n") + "\n");
    console.log(`${set.puzzles.length} puzzles from ${set.games} games → ${file}`);
  },
  3_600_000,
);
