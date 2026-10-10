/**
 * Win-probability data: positions from real games with the engine's evaluation, the players'
 * ratings and the result, to fit how an evaluation turns into an expected score at each rating
 * (scripts/eval/fit-winprob.py). Resumable and sharded like the brilliant hunt.
 *
 *   EVAL_GAMES=scripts/eval/out/ay7u-3m.json [EVAL_DEPTH=12] [EVAL_EVERY=3] [EVAL_MAXGAP=150] [EVAL_SHARD=0/8] [EVAL_BUDGET_S=520] \
 *     EVAL_OUT=scripts/eval/out/winprob-ay7u-0.jsonl npx vitest run src/lib/eval/winprob-data.test.ts
 *
 * One line per position: {cp (White's view), white, black (ratings), score (White's result: 1, ½, 0), tc}.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { it } from "vitest";
import { terminalEval } from "../review/classify";
import { parseGame } from "../review/pgn";
import { nodeSearcher, type SavedGame } from "./nodeEngine";

const env = process.env;

it.skipIf(!env.EVAL_GAMES || !env.EVAL_OUT)("collect win-probability data", async () => {
  const search = await nodeSearcher();
  const depth = Number(env.EVAL_DEPTH ?? 12);
  const every = Number(env.EVAL_EVERY ?? 3);
  const out = env.EVAL_OUT!;
  const [shard, shards] = (env.EVAL_SHARD ?? "0/1").split("/").map(Number);
  const budget = Date.now() + Number(env.EVAL_BUDGET_S ?? 520) * 1000;
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as { url?: string; done?: boolean };
      if (r.done && r.url) done.add(r.url);
    }
  const games = env
    .EVAL_GAMES!.split(",")
    .flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as SavedGame[])
    .filter((g) => g.time_class !== "bullet")
    .filter((_, i) => i % shards === shard);
  for (const sg of games) {
    if (Date.now() > budget) break;
    if (done.has(sg.url)) continue;
    let g;
    try {
      g = parseGame(sg.pgn);
    } catch {
      continue;
    }
    const score = g.result === "1-0" ? 1 : g.result === "0-1" ? 0 : g.result === "1/2-1/2" ? 0.5 : null;
    const white = Number(g.whiteElo);
    const black = Number(g.blackElo);
    if (score === null || !white || !black || Math.abs(white - black) > Number(env.EVAL_MAXGAP ?? 150)) continue;
    const lines: string[] = [];
    for (let i = 12; i < g.moves.length; i += every) {
      const fen = g.moves[i].fenBefore;
      if (terminalEval(fen)) continue;
      const l = (await search({ fen, depth, multipv: 1, fresh: true }))[0];
      if (!l) continue;
      const cp = l.eval.kind === "cp" ? l.eval.cp : l.eval.winner === "w" ? 10000 : -10000;
      lines.push(JSON.stringify({ cp, white, black, score, tc: sg.time_class, ply: i }));
    }
    appendFileSync(out, lines.map((x) => x + "\n").join("") + JSON.stringify({ url: sg.url, done: true }) + "\n");
  }
}, 3_600_000);
