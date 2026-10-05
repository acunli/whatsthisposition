/**
 * Explanation report: reviews real games and prints, for the interesting moves,
 * everything the reasoning engine says (headline, ideas with weights, the threat
 * before the move, the reply, the line, the alternative and the better move).
 * Read it critically, fix the rule that produced a bad sentence, run it again.
 *
 * Skipped unless EVAL_GAMES points at a games file (scripts/eval/fetch-games.mjs):
 *   EVAL_GAMES=scripts/eval/out/games.json [EVAL_OUT=…] [EVAL_SKIP=0] [EVAL_N=4] [EVAL_PER=8] [EVAL_DEPTH=12] \
 *     npx vitest run src/lib/eval/explain-report.test.ts
 * EVAL_PGN=file.pgn (with EVAL_FOCUS=42,43 for plies to always include) reviews one PGN instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import openings from "@/data/openings.json";
import { findThreat, reasonMove } from "../reason/reason";
import { makeBook } from "../review/book";
import { CLASS_INFO } from "../review/classify";
import { parseGame } from "../review/pgn";
import { analysePositions, classifyGame } from "../review/review";
import { nodeSearcher, type SavedGame } from "./nodeEngine";

const env = process.env;
const enabled = !!(env.EVAL_GAMES || env.EVAL_PGN);

it.skipIf(!enabled)("write the explanation report", async () => {
  const search = await nodeSearcher();
  const book = makeBook(openings as never);
  const depth = Number(env.EVAL_DEPTH ?? 12);
  const focus = (env.EVAL_FOCUS ?? "").split(",").filter(Boolean).map(Number);
  const games: { pgn: string; focus: number[] }[] = env.EVAL_PGN
    ? [{ pgn: readFileSync(env.EVAL_PGN, "utf8"), focus }]
    : (JSON.parse(readFileSync(env.EVAL_GAMES!, "utf8")) as SavedGame[])
        // Games Chess.com reviewed, not bullet: the same list the 2026-10-05 rounds used, so EVAL_SKIP numbers match.
        .filter((g) => g.accuracies && g.time_class !== "bullet")
        .slice(Number(env.EVAL_SKIP ?? 0), Number(env.EVAL_SKIP ?? 0) + Number(env.EVAL_N ?? 4))
        .map((g) => ({ pgn: g.pgn, focus: [] }));
  const out: string[] = [];
  for (const { pgn, focus: plies } of games) {
    const g = parseGame(pgn);
    const r = classifyGame(g, await analysePositions(g, [search], { depth }), book);
    out.push(`\n######## ${g.white} vs ${g.black} (${g.result}) ${g.headers.Link ?? ""}`);
    const pick = r.moves
      .filter((m, i) => plies.includes(i + 1) || ["brilliant", "great", "mistake", "blunder", "miss"].includes(m.cls) || (["best", "excellent"].includes(m.cls) && i % 9 === 4))
      .slice(0, Number(env.EVAL_PER ?? 8));
    for (const c of pick) {
      const m = c.move;
      const t0 = Date.now();
      const threatBefore = await findThreat(m.fenBefore, search, depth - 2, c.bestLine?.eval ?? c.evalBefore);
      const rs = await reasonMove({
        fen: m.fenBefore,
        uci: m.uci,
        line: c.replyLine ? { pv: [m.uci, ...c.replyLine.pv], eval: c.evalAfter, depth: c.replyLine.depth } : undefined,
        best: c.bestLine ?? undefined,
        second: c.secondLine ?? undefined,
        search,
        depth,
        threatBefore,
      });
      out.push(`\n=== ply ${m.ply} ${CLASS_INFO[c.cls].label.toUpperCase()} ${rs?.label}  [${Date.now() - t0}ms]  best ${c.bestSan}  fen ${m.fenBefore}`);
      if (!rs) continue;
      out.push(`HEADLINE: ${rs.headline}`);
      for (const i of rs.ideas.slice(0, 6)) out.push(`  - [${i.kind} ${i.weight.toFixed(0)} ${i.evidence}] ${i.text}`);
      if (rs.opponentThreat) out.push(`  THREAT BEFORE: ${rs.opponentThreat.text} parried=${rs.opponentThreat.parried}`);
      if (rs.refutation) out.push(`  REPLY: ${rs.refutation.text}`);
      if (rs.line) out.push(`  LINE: ${rs.line.text}`);
      for (const a of rs.alternatives) out.push(`  ALT: ${a.text}`);
      if (c.bestLine && c.bestUci && c.bestUci !== m.uci) {
        const b = await reasonMove({ fen: m.fenBefore, uci: c.bestUci, line: c.bestLine, best: c.bestLine, second: c.secondLine ?? undefined, search, depth, threatBefore });
        if (b) out.push(`  BETTER: ${b.headline}  | ${b.line?.text ?? ""}`);
      }
    }
  }
  writeFileSync(env.EVAL_OUT ?? "scripts/eval/out/explain-report.txt", out.join("\n"));
}, 3_600_000);
