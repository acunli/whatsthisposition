/**
 * Brilliant report: the "why it's brilliant" explanation for every move in the corpus
 * from brilliant-hunt.test.ts (or one position), to read critically and improve.
 *
 *   EVAL_CORPUS=scripts/eval/out/brilliants-0.jsonl,… [EVAL_SKIP=0] [EVAL_N=20] [EVAL_DEPTH=14] [EVAL_OUT=…] \
 *     npx vitest run src/lib/eval/brilliant-report.test.ts
 *   EVAL_FEN="<fen before>" EVAL_UCI=h6f8 npx vitest run src/lib/eval/brilliant-report.test.ts
 *
 * One position writes scripts/eval/out/brilliant-one.txt, so it never replaces the corpus report.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { findThreat } from "../reason/reason";
import { explainSacrifice } from "../reason/sacrifice";
import { Chess } from "chess.js";
import { classifyMove, terminalEval, type PositionAnalysis } from "../review/classify";
import { parseGame } from "../review/pgn";
import { buildVariation } from "../variation";
import type { BrilliantRecord } from "./brilliant-hunt.test";
import { nodeSearcher } from "./nodeEngine";

const env = process.env;

it.skipIf(!env.EVAL_CORPUS && !env.EVAL_FEN)("write the brilliant report", async () => {
  const search = await nodeSearcher();
  const depth = Number(env.EVAL_DEPTH ?? 14);
  const analyse = async (fen: string, multipv: number): Promise<PositionAnalysis> => {
    const t = terminalEval(fen);
    if (t) return { lines: [], eval: t, depth: 0 };
    const lines = await search({ fen, depth: 16, multipv, fresh: true });
    return { lines, eval: lines[0].eval, depth: lines[0].depth };
  };
  const out: string[] = [];
  let recs: BrilliantRecord[] = [];
  if (env.EVAL_FEN) {
    const v = buildVariation(env.EVAL_FEN, [env.EVAL_UCI!], 1).moves[0];
    recs = [{ url: "", white: "", black: "", ply: 0, san: v.san, uci: v.uci, fenBefore: env.EVAL_FEN, fenAfter: v.fenAfter, before: await analyse(env.EVAL_FEN, 2), after: await analyse(v.fenAfter, 1), context: "" }];
  } else {
    for (const f of env.EVAL_CORPUS!.split(","))
      if (existsSync(f))
        for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
          const r = JSON.parse(l);
          if (r.san) recs.push(r);
        }
    // Only moves that are still Brilliant under the current rules (the corpus may predate a rule change).
    recs = recs.filter((r) => {
      const move = parseGame(`[FEN "${r.fenBefore}"]\n[SetUp "1"]\n\n${r.san} *`).moves[0];
      return classifyMove({ move, before: r.before, after: r.after, legalMoves: new Chess(r.fenBefore).moves().length, inBook: false }).cls === "brilliant";
    });
    out.push(`${recs.length} still brilliant under the current rules`);
    recs = recs.slice(Number(env.EVAL_SKIP ?? 0), Number(env.EVAL_SKIP ?? 0) + Number(env.EVAL_N ?? 20));
  }
  for (const r of recs) {
    const t0 = Date.now();
    const threatBefore = await findThreat(r.fenBefore, search, depth - 2, r.before.eval);
    const reply = r.after.lines[0];
    const x = await explainSacrifice({
      fen: r.fenBefore,
      uci: r.uci,
      reply: reply ? { pv: reply.pv, eval: reply.eval, depth: reply.depth } : undefined,
      best: r.before.lines[0],
      second: r.before.lines[1],
      threatBefore,
      search,
      depth,
    });
    out.push(`\n=== ${r.white} vs ${r.black} ply ${r.ply} ${r.san}  [${Date.now() - t0} ms]  ${r.url}\n    ${r.context}\n    fen ${r.fenBefore}`);
    if (!x) {
      out.push("    (no explanation)");
      continue;
    }
    out.push(`HEADLINE: ${x.headline}`);
    for (const s of x.steps) out.push(`  [${s.title}] ${s.text}${env.EVAL_LINES === "1" && s.line ? `\n      line: ${buildVariation(s.line.fen, s.line.pv, 14).moves.map((m) => m.san).join(" ")}` : ""}`);
  }
  writeFileSync(env.EVAL_OUT ?? (env.EVAL_FEN ? "scripts/eval/out/brilliant-one.txt" : "scripts/eval/out/brilliant-report.txt"), out.join("\n"));
}, 3_600_000);
