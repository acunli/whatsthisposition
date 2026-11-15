/**
 * Commentary report: takes positions from real games (a few per game, spread over the
 * game), searches them the way the analysis page does and prints the whole commentary:
 * the position's types, what each side likes and dislikes, the plans by type and which
 * of them the engine's lines follow. Read it as a coach would, fix the rule behind a
 * wrong or empty sentence in general terms (src/lib/commentary), run it again on games
 * not read yet.
 *
 * Skipped unless EVAL_GAMES points at a games file (scripts/eval/fetch-games.mjs):
 *   EVAL_GAMES=scripts/eval/out/games.json [EVAL_OUT=…] [EVAL_SKIP=0] [EVAL_N=6] [EVAL_PLIES=16,30,46,64,90] [EVAL_DEPTH=14] \
 *     npx vitest run src/lib/eval/commentary-report.test.ts
 * EVAL_FENS=file.txt (one FEN per line, "name | fen" allowed) reports those positions instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { PLAN_CATEGORY, buildCommentary } from "../commentary";
import { formatEval } from "../engine/score";
import { parseGame } from "../review/pgn";
import { buildVariation } from "../variation";
import { nodeSearcher, type SavedGame } from "./nodeEngine";

const env = process.env;
const enabled = !!(env.EVAL_GAMES || env.EVAL_FENS);

it.skipIf(!enabled)(
  "write the commentary report",
  async () => {
    const search = await nodeSearcher();
    const depth = Number(env.EVAL_DEPTH ?? 14);
    const plies = (env.EVAL_PLIES ?? "16,30,46,64,90").split(",").map(Number);
    const positions: { name: string; fen: string }[] = [];
    if (env.EVAL_FENS) {
      for (const line of readFileSync(env.EVAL_FENS, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const [a, b] = t.includes("|") ? t.split("|").map((x) => x.trim()) : ["", t];
        positions.push({ name: a, fen: b });
      }
    } else {
      const games = (JSON.parse(readFileSync(env.EVAL_GAMES!, "utf8")) as SavedGame[]).filter((g) => g.time_class !== "bullet").slice(Number(env.EVAL_SKIP ?? 0), Number(env.EVAL_SKIP ?? 0) + Number(env.EVAL_N ?? 6));
      for (const sg of games) {
        const g = parseGame(sg.pgn);
        for (const ply of plies) {
          const m = g.moves[ply - 1];
          if (m) positions.push({ name: `${g.white} vs ${g.black}, after ${m.color === "w" ? `${m.moveNumber}.` : `${m.moveNumber}…`}${m.san}  ${sg.url}`, fen: m.fenAfter });
        }
      }
    }
    const out: string[] = [];
    for (const { name, fen } of positions) {
      const lines = await search({ fen, depth, multipv: 3, fresh: true });
      const c = buildCommentary(fen, { lines: lines.map((l) => ({ pv: l.pv, eval: l.eval, depth: l.depth })) });
      out.push(`\n################ ${name}\n${fen}`);
      out.push(`engine: ${lines.map((l) => `${formatEval(l.eval)} ${buildVariation(fen, l.pv, 6).moves.map((m) => m.san).join(" ")}`).join("  |  ")}`);
      out.push(`HEAD  ${c.headline}`);
      for (const s of c.story) out.push(`  ~ ${s}`);
      for (const t of c.types) out.push(`  [${t.group}] ${t.name}${t.side ? ` (${t.side})` : ""}: ${t.meaning}`);
      for (const side of ["w", "b"] as const) {
        out.push(` -- ${side === "w" ? "WHITE" : "BLACK"}`);
        for (const p of c.sides[side].likes) out.push(`   + (${p.weight}) ${p.title}: ${p.text}`);
        for (const p of c.sides[side].dislikes) out.push(`   - (${p.weight}) ${p.title}: ${p.text}`);
        for (const p of c.sides[side].plans) {
          out.push(`   > (${p.weight}) [${PLAN_CATEGORY[p.category].name}] ${p.title}${p.keySan ? ` {${p.keySan}}` : ""}${p.engine?.note ? `   << ${p.engine.note}` : ""}`);
          out.push(`       why: ${p.why}`);
          for (const s of p.steps) out.push(`       · ${s.text}`);
          if (p.risk) out.push(`       ! ${p.risk}`);
        }
      }
    }
    const file = env.EVAL_OUT ?? "scripts/eval/out/commentary-report.txt";
    writeFileSync(file, out.join("\n") + "\n");
    console.log(`${positions.length} positions → ${file}`);
  },
  3_600_000,
);
