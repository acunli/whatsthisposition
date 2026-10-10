/**
 * Brilliant rule study: reclassifies a corpus of stored analyses (from brilliant-hunt.test.ts,
 * ideally run with EVAL_ALL=1) under the current rules, compares them with the earlier rule
 * (a 0.04 margin over the second-best line, and Lichess's curve for "already decided"), and lists every move the two disagree on, with the
 * numbers that decided it. Sacrifices whose runner-up is a sacrifice too get their quiet move
 * searched (as the review does) unless the record already has one.
 *
 *   EVAL_CORPUS=scripts/eval/out/brilliants-0.jsonl,… [EVAL_QUIET=0] npx vitest run src/lib/eval/brilliant-rules.test.ts
 *
 * Output: scripts/eval/out/brilliant-rules.txt.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chess.js";
import { it } from "vitest";
import { classifyMove, expectedScore, needsQuietSearch, type PositionAnalysis } from "../review/classify";
import { parseGame } from "../review/pgn";
import { detectSacrifice } from "../review/safety";
import type { BrilliantRecord } from "./brilliant-hunt.test";
import { nodeSearcher } from "./nodeEngine";

const env = process.env;
const OLD_GAP = 0.04;
const sanOf = (fen: string, uci: string) => {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
};
const fmt = (e: PositionAnalysis["eval"]) => (e.kind === "cp" ? (e.cp / 100).toFixed(2) : `M${e.moves}${e.winner}`);

it.skipIf(!env.EVAL_CORPUS)("brilliant rule study", async () => {
  const recs: BrilliantRecord[] = [];
  const seen = new Set<string>();
  for (const f of env.EVAL_CORPUS!.split(","))
    if (existsSync(f))
      for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
        const r = JSON.parse(l) as BrilliantRecord;
        const key = `${r.url}#${r.ply}`;
        if (r.san && r.before && !seen.has(key)) {
          seen.add(key);
          recs.push(r);
        }
      }
  let now = 0;
  let old = 0;
  const differ: string[] = [];
  const kept: string[] = [];
  for (const r of recs) {
    const move = parseGame(`[FEN "${r.fenBefore}"]\n[SetUp "1"]\n\n${r.san} *`).moves[0];
    let before = r.before;
    if (env.EVAL_QUIET !== "0" && needsQuietSearch(r.fenBefore, move.uci, before)) {
      const quiet = new Chess(r.fenBefore)
        .moves({ verbose: true })
        .map((m) => m.lan)
        .filter((u) => u !== move.uci && !detectSacrifice(r.fenBefore, u)?.pieces.length);
      const search = await nodeSearcher();
      const q = quiet.length ? (await search({ fen: r.fenBefore, depth: before.depth, multipv: 1, searchmoves: quiet, fresh: true }))[0] : undefined;
      if (q) before = { ...before, quiet: q };
    }
    const c = classifyMove({ move, before, after: r.after, legalMoves: new Chess(r.fenBefore).moves().length, inBook: false, rating: r.rating });
    const second = before.lines[1];
    const gap = second ? c.before - expectedScore(second.eval, move.color) : null;
    const top = c.bestUci === move.uci;
    // The old rule: 0.04 over the runner-up, and "decided" on Lichess's curve against the runner-up.
    const oldOpen = !(second ? expectedScore(second.eval, move.color) >= 0.93 : c.after >= 0.93) && c.after >= 0.45;
    const wasBrilliant = oldOpen && top && !!c.sacrifice?.pieces.length && (gap === null || gap >= OLD_GAP);
    const isBrilliant = c.cls === "brilliant";
    now += +isBrilliant;
    old += +wasBrilliant;
    if (!c.sacrifice?.pieces.length || !top) continue;
    const q = c.quietLine;
    const line = `${r.white} vs ${r.black} ply ${r.ply} ${r.san}  [${c.cls}${wasBrilliant !== isBrilliant ? `, was ${wasBrilliant ? "brilliant" : "not"}` : ""}]  best ${fmt(before.eval)}, second ${second ? `${sanOf(r.fenBefore, second.pv[0])} ${fmt(second.eval)} (gap ${gap!.toFixed(3)})` : "none"}, quiet ${q ? `${sanOf(r.fenBefore, q.pv[0])} ${fmt(q.eval)}${q === before.quiet ? " (searched)" : ""} margin ${(c.before - expectedScore(q.eval, move.color)).toFixed(3)}` : "none"}  gives ${c.sacrifice.pieces.map((p) => p.type + p.square).join(",")}\n    ${r.context}\n    fen ${r.fenBefore}  ${r.url}`;
    if (wasBrilliant !== isBrilliant) differ.push(line);
    else if (!isBrilliant) kept.push(line);
  }
  const out = [
    `${recs.length} moves · Brilliant now ${now} · under the old rule (${OLD_GAP} over the second-best line) ${old}`,
    "",
    `== ${differ.length} moves the rules disagree on`,
    ...differ,
    "",
    `== ${kept.length} sacrifices the engine prefers that neither rule calls Brilliant`,
    ...kept,
  ];
  writeFileSync(env.EVAL_OUT ?? "scripts/eval/out/brilliant-rules.txt", out.join("\n"));
}, 3_600_000);
