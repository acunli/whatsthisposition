/**
 * Brilliant hunt: finds the moves our classifier labels Brilliant in many games,
 * cheaply, and saves them as a corpus for brilliant-report.test.ts.
 *
 * A board-only check (detectSacrifice: material really left or put en prise) picks
 * the few candidate moves per game; only those get engine searches, and the same
 * classifyMove as the review decides. Results are appended to a JSON-lines file and
 * games already in it are skipped, so a run can be stopped and resumed.
 *
 * Skipped unless EVAL_GAMES is set (one or more files from scripts/eval/fetch-games.mjs):
 *   EVAL_GAMES=scripts/eval/out/hikaru.json,scripts/eval/out/top-LyonBeast.json \
 *   [EVAL_DEPTH=16] [EVAL_BULLET=0] [EVAL_SHARD=0/4] [EVAL_BUDGET_S=540] [EVAL_OUT=scripts/eval/out/brilliants.jsonl] \
 *     npx vitest run src/lib/eval/brilliant-hunt.test.ts
 *
 * EVAL_VERIFY=1 does what the review does: a sacrifice found at EVAL_DEPTH is searched again
 * VERIFY_EXTRA deeper, with the best quiet move when the runner-up is a sacrifice too.
 * EVAL_ALL=1 keeps every sacrifice the classifier weighed, Brilliant or not (field `cls`), so
 * brilliant-rules.test.ts can compare rules on them offline.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { Chess } from "chess.js";
import { it } from "vitest";
import { classifyMove, gameRating, needsQuietSearch, terminalEval, type ClassifiedMove, type MoveClass, type PositionAnalysis } from "../review/classify";
import { VERIFY_EXTRA } from "../review/depths";
import { parseGame } from "../review/pgn";
import { detectSacrifice, unsafePieces } from "../review/safety";
import { nodeSearcher, type SavedGame } from "./nodeEngine";

const env = process.env;

export interface BrilliantRecord {
  url: string;
  white: string;
  black: string;
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  before: PositionAnalysis;
  after: PositionAnalysis;
  /** The game moves just before and after, for context. */
  context: string;
  /** The label when it was found (EVAL_ALL keeps sacrifices that aren't Brilliant too). */
  cls?: MoveClass;
  /** The players' rating (gameRating), which the "already decided" gates depend on. */
  rating?: number | null;
}

it.skipIf(!env.EVAL_GAMES)("hunt for brilliant moves", async () => {
  const search = await nodeSearcher();
  const depth = Number(env.EVAL_DEPTH ?? 16);
  const out = env.EVAL_OUT ?? "scripts/eval/out/brilliants.jsonl";
  const [shard, shards] = (env.EVAL_SHARD ?? "0/1").split("/").map(Number);
  const budget = Date.now() + Number(env.EVAL_BUDGET_S ?? 540) * 1000;
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as { url: string; done?: boolean };
      if (r.done) done.add(r.url);
    }
  const games = env
    .EVAL_GAMES!.split(",")
    .flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as SavedGame[])
    .filter((g) => env.EVAL_BULLET === "1" || g.time_class !== "bullet")
    .filter((_, i) => i % shards === shard);
  const analyse = async (fen: string, multipv: number, d = depth): Promise<PositionAnalysis> => {
    const t = terminalEval(fen);
    if (t) return { lines: [], eval: t, depth: 0 };
    const lines = await search({ fen, depth: d, multipv, fresh: true });
    return { lines, eval: lines[0].eval, depth: lines[0].depth };
  };
  let n = 0;
  for (const sg of games) {
    if (Date.now() > budget) break;
    if (done.has(sg.url)) continue;
    let g;
    try {
      g = parseGame(sg.pgn);
    } catch {
      continue;
    }
    for (let i = 0; i < g.moves.length; i++) {
      const m = g.moves[i];
      // Book moves aren't labelled Brilliant; skip the first moves quickly.
      if (i < 10) continue;
      const prev = g.moves[i - 1];
      const declined = prev ? unsafePieces(prev.fenBefore, m.color) : [];
      if (!detectSacrifice(m.fenBefore, m.uci, declined)) continue;
      let before = await analyse(m.fenBefore, 2);
      let after = await analyse(m.fenAfter, 1);
      const previous = prev ? ({ move: prev, cls: "best", before: 0.5 } as unknown as ClassifiedMove) : undefined;
      const legalMoves = new Chess(m.fenBefore).moves().length;
      const rating = gameRating(g.whiteElo, g.blackElo);
      let c = classifyMove({ move: m, before, after, legalMoves, inBook: false, previous, rating });
      if (env.EVAL_VERIFY === "1" && c.sacrifice?.pieces.length) {
        before = await analyse(m.fenBefore, 2, depth + VERIFY_EXTRA);
        after = await analyse(m.fenAfter, 1, depth + VERIFY_EXTRA);
        if (needsQuietSearch(m.fenBefore, m.uci, before, declined)) {
          const quiet = new Chess(m.fenBefore)
            .moves({ verbose: true })
            .map((x) => x.lan)
            .filter((u) => u !== m.uci && !detectSacrifice(m.fenBefore, u, declined)?.pieces.length);
          const q = quiet.length ? (await search({ fen: m.fenBefore, depth: depth + VERIFY_EXTRA, multipv: 1, searchmoves: quiet, fresh: true }))[0] : undefined;
          if (q) before = { ...before, quiet: q };
        }
        c = classifyMove({ move: m, before, after, legalMoves, inBook: false, previous, rating });
      }
      if (c.cls !== "brilliant" && !(env.EVAL_ALL === "1" && c.sacrifice?.pieces.length)) continue;
      const rec: BrilliantRecord = {
        url: sg.url,
        white: g.white,
        black: g.black,
        ply: m.ply,
        san: m.san,
        uci: m.uci,
        fenBefore: m.fenBefore,
        fenAfter: m.fenAfter,
        before,
        after,
        cls: c.cls,
        rating,
        context: g.moves
          .slice(Math.max(0, i - 3), i + 4)
          .map((x) => `${x.moveNumber}${x.color === "w" ? "." : "…"}${x.san}`)
          .join(" "),
      };
      appendFileSync(out, JSON.stringify(rec) + "\n");
      n++;
    }
    appendFileSync(out, JSON.stringify({ url: sg.url, done: true }) + "\n");
  }
  console.log(`shard ${shard}/${shards}: ${n} brilliant moves found`);
}, 3_600_000);
