/**
 * Miss report: reviews games exactly as the site does (runReview: every position at the review
 * depth, the positions behind tactical labels again deeper, the master book, the players' rating)
 * and prints every error with what decided its label: the opponent's move before it, the
 * evaluations, the best move's line and the material each line wins or loses.
 *
 * Every engine search is cached in JSON-lines files, so once the games are warm the report runs
 * without the engine and label rules can be compared by running it before and after a change
 * (EVAL_LABELS saves every move's label and, for errors, what decided it; scripts/eval/miss-diff.mjs
 * compares two runs).
 *
 * Skipped unless EVAL_GAMES is set (one or more files from scripts/eval/fetch-games.mjs):
 *   EVAL_GAMES=scripts/eval/out/ay7u-oct.json [EVAL_N=120] [EVAL_DEPTH=14] [EVAL_SHARD=0/8] [EVAL_BUDGET_S=420] \
 *   [EVAL_CACHE=scripts/eval/out/miss-cache-0.jsonl] [EVAL_CACHES=a.jsonl,b.jsonl] \
 *   [EVAL_OUT=scripts/eval/out/miss-report.txt] [EVAL_LABELS=scripts/eval/out/miss-labels.json] \
 *   [EVAL_URL=<one game>] [EVAL_EXCLUDE=<urls>] [EVAL_DEBUG=<file>: logs each new search before it starts] \
 *     npx vitest run src/lib/eval/miss-report.test.ts
 *
 * Run in parallel shards in the foreground, each with its own EVAL_CACHE, EVAL_OUT and EVAL_LABELS
 * and with EVAL_CACHES listing every shard's cache (scripts/eval/README.md §7). Even warm, a game
 * takes about 20 s: runReview labels the game again after every search.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import openings from "@/data/openings.json";
import type { Searcher } from "../deep/deep";
import type { EngineLine } from "../engine/client";
import { formatEval } from "../engine/score";
import { makeBook } from "../review/book";
import { lineMaterial, lossClass, type ClassifiedMove } from "../review/classify";
import { VERIFY_EXTRA } from "../review/depths";
import { readMasters } from "../review/masters";
import { parseGame, type GameMove } from "../review/pgn";
import { classifyGame, runReview, tally } from "../review/review";
import { buildVariation } from "../variation";
import { nodeSearcher, type SavedGame } from "./nodeEngine";

const env = process.env;

const ERRORS = new Set(["inaccuracy", "mistake", "miss", "blunder"]);

it.skipIf(!env.EVAL_GAMES)("miss report", async () => {
  const depth = Number(env.EVAL_DEPTH ?? 14);
  const [shard, shards] = (env.EVAL_SHARD ?? "0/1").split("/").map(Number);
  const budget = Date.now() + Number(env.EVAL_BUDGET_S ?? 1e6) * 1000;
  const write = env.EVAL_CACHE ?? "scripts/eval/out/miss-cache.jsonl";
  const cache = new Map<string, EngineLine[]>();
  for (const f of new Set([...(env.EVAL_CACHES ?? "").split(",").filter(Boolean), write]))
    if (existsSync(f))
      for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
        const r = JSON.parse(l) as { k: string; v: EngineLine[] };
        cache.set(r.k, r.v);
      }
  let engine: Searcher | null = null;
  let searched = 0;
  const search: Searcher = async (r) => {
    const k = `${r.fen}|${r.depth}|${r.multipv ?? 1}|${(r.searchmoves ?? []).join(",")}`;
    const hit = cache.get(k);
    if (hit) return hit;
    if (env.EVAL_DEBUG) appendFileSync(env.EVAL_DEBUG, `${new Date().toISOString()} ${k}\n`);
    engine ??= await nodeSearcher();
    const v = await engine(r);
    cache.set(k, v);
    appendFileSync(write, JSON.stringify({ k, v }) + "\n");
    searched++;
    return v;
  };
  const bin = readFileSync("public/data/masters-book.bin.gz");
  const masters = await readMasters(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const book = makeBook(openings as never, masters);
  const games = env
    .EVAL_GAMES!.split(",")
    .flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as SavedGame[])
    .filter((g) => g.time_class !== "bullet" && (!env.EVAL_URL || g.url === env.EVAL_URL) && !(env.EVAL_EXCLUDE ?? "").split(",").includes(g.url))
    .sort((a, b) => (b as { end_time?: number }).end_time! - (a as { end_time?: number }).end_time!)
    .slice(0, Number(env.EVAL_N ?? 120))
    .filter((_, i) => i % shards === shard);

  const num = (m: GameMove) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;
  const sans = (fen: string, pv: string[], n = 6) =>
    buildVariation(fen, pv, n)
      .moves.map((x) => x.san)
      .join(" ");
  const out: string[] = [];
  const labels: { url: string; ply: number; cls: string; color: string }[] = [];
  const totals: Record<string, number> = {};
  let reviewed = 0;
  for (const sg of games) {
    if (Date.now() > budget) break;
    let g;
    try {
      g = parseGame(sg.pgn);
    } catch {
      continue;
    }
    const positions = await runReview(g, [search], { depth, verifyDepth: depth + VERIFY_EXTRA, book: Promise.resolve(book) });
    const r = classifyGame(g, positions, book);
    reviewed++;
    for (const [cls, n] of Object.entries(tally(r.moves))) totals[cls] = (totals[cls] ?? 0) + n.w + n.b;
    const errs: string[] = [];
    r.moves.forEach((c: ClassifiedMove, i) => {
      const m = c.move;
      const prev = i > 0 ? r.moves[i - 1] : undefined;
      const best = c.bestLine;
      const played = [m.uci, ...(c.replyLine?.pv ?? [])];
      const bestGain = best ? lineMaterial(m.fenBefore, best.pv, m.color) : 0;
      const playedGain = lineMaterial(m.fenBefore, played, m.color);
      const band = lossClass(c.evalBefore, c.evalAfter, m.color);
      const baseline = prev ? 1 - prev.before : null;
      labels.push({
        url: sg.url,
        ply: m.ply,
        cls: c.cls,
        color: m.color,
        ...(c.cls === "book" || c.cls === "forced"
          ? {}
          : {
              band,
              loss: c.loss,
              before: c.before,
              after: c.after,
              baseline,
              prev: prev?.cls,
              bestGain,
              playedGain,
              bestMate: c.evalBefore.kind === "mate" && c.evalBefore.winner === m.color ? c.evalBefore.moves : null,
              mated: c.evalAfter.kind === "mate" && c.evalAfter.winner !== m.color ? c.evalAfter.moves : null,
              evalBefore: formatEval(c.evalBefore),
              evalAfter: formatEval(c.evalAfter),
              san: num(m),
              best: best ? sans(m.fenBefore, best.pv) : null,
              game: sans(m.fenBefore, played),
              rating: Number(m.color === "w" ? g.whiteElo : g.blackElo) || null,
            }),
      });
      if (!ERRORS.has(c.cls)) return;
      errs.push(
        [
          `  ${num(m).padEnd(12)} ${c.cls.toUpperCase().padEnd(10)} band ${band.padEnd(10)} loss ${c.loss.toFixed(3)}  ` +
            `${(100 * c.before).toFixed(0)}% → ${(100 * c.after).toFixed(0)}%` +
            (baseline !== null ? ` (before their move ${(100 * baseline).toFixed(0)}%)` : ""),
          `      after ${prev ? `${num(prev.move)} ${prev.cls}` : "the start"}; eval ${formatEval(c.evalBefore)} → ${formatEval(c.evalAfter)}`,
          `      best ${best ? sans(m.fenBefore, best.pv) : "—"}  [material ${bestGain >= 0 ? "+" : ""}${bestGain}]`,
          `      game ${sans(m.fenBefore, played)}  [material ${playedGain >= 0 ? "+" : ""}${playedGain}]`,
        ].join("\n"),
      );
    });
    out.push(`${sg.url}  ${g.white} (${g.whiteElo ?? "?"}) vs ${g.black} (${g.blackElo ?? "?"})  ${g.result}  ${sg.time_class}\n${errs.join("\n")}`);
  }
  const summary = `${reviewed} games, ${searched} new searches. Labels: ${Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}`;
  console.log(summary);
  writeFileSync(env.EVAL_OUT ?? "scripts/eval/out/miss-report.txt", `${summary}\n\n${out.join("\n\n")}\n`);
  writeFileSync(env.EVAL_LABELS ?? "scripts/eval/out/miss-labels.json", JSON.stringify(labels));
}, 7_200_000);
