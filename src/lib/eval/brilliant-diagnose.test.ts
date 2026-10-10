/**
 * Why is (or isn't) this move Brilliant? Runs the review's two passes on one move (depth, then
 * depth + VERIFY_EXTRA) and prints every condition classifyMove and detectSacrifice check.
 *
 *   EVAL_PGN=game.pgn EVAL_PLY=27 [EVAL_DEPTH=18] npx vitest run src/lib/eval/brilliant-diagnose.test.ts
 *
 * EVAL_PLY counts half-moves from 1 (14.dxe6 is ply 27). Output: scripts/eval/out/brilliant-diagnose.txt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chess.js";
import { it } from "vitest";
import { VERIFY_EXTRA } from "../review/depths";
import { SACRIFICE_MARGIN, classifyMove, decisiveSlope, expectedScore, expectedScoreAt, gameRating, needsQuietSearch, quietAlternative, terminalEval, type PositionAnalysis } from "../review/classify";
import { parseGame } from "../review/pgn";
import { detectSacrifice, unsafePieces } from "../review/safety";
import { buildVariation } from "../variation";
import { nodeSearcher } from "./nodeEngine";

const env = process.env;

it.skipIf(!env.EVAL_PGN || !env.EVAL_PLY)("diagnose one move", async () => {
  const search = await nodeSearcher();
  const game = parseGame(readFileSync(env.EVAL_PGN!, "utf8"));
  const ply = Number(env.EVAL_PLY);
  const depth = Number(env.EVAL_DEPTH ?? 18);
  const move = game.moves[ply - 1];
  const prevMove = ply > 1 ? game.moves[ply - 2] : null;
  const rating = gameRating(game.whiteElo, game.blackElo);
  const slope = decisiveSlope(rating);
  const out: string[] = [`${move.color === "w" ? `${Math.ceil(ply / 2)}.` : `${Math.ceil(ply / 2)}…`}${move.san}  ply ${ply}`, `fen before ${move.fenBefore}`];

  const analyse = async (fen: string, d: number): Promise<PositionAnalysis> => {
    const t = terminalEval(fen);
    if (t) return { lines: [], eval: t, depth: 0 };
    const lines = await search({ fen, depth: d, multipv: 2, fresh: true });
    return { lines, eval: lines[0].eval, depth: lines[0].depth };
  };
  const fmt = (e: PositionAnalysis["eval"]) => (e.kind === "cp" ? (e.cp / 100).toFixed(2) : `M${e.moves}${e.winner}`);
  const san = (fen: string, pv: string[]) => buildVariation(fen, pv.slice(0, 8), 8).moves.map((m) => m.san).join(" ");

  for (const d of [depth, depth + VERIFY_EXTRA]) {
    const t0 = Date.now();
    let before = await analyse(move.fenBefore, d);
    const after = await analyse(move.fenAfter, d);
    const declined = prevMove ? unsafePieces(prevMove.fenBefore, move.color) : [];
    // As the review does: when the runner-up is a sacrifice too, search the best quiet move.
    if (needsQuietSearch(move.fenBefore, move.uci, before, declined)) {
      const quietMoves = new Chess(move.fenBefore)
        .moves({ verbose: true })
        .map((x) => x.lan)
        .filter((u) => u !== move.uci && !detectSacrifice(move.fenBefore, u, declined)?.pieces.length);
      const q = quietMoves.length ? (await search({ fen: move.fenBefore, depth: d, multipv: 1, searchmoves: quietMoves, fresh: true }))[0] : undefined;
      if (q) before = { ...before, quiet: q };
    }
    let previous;
    if (prevMove) {
      const pb = await analyse(prevMove.fenBefore, d);
      previous = classifyMove({ move: prevMove, before: pb, after: before, legalMoves: new Chess(prevMove.fenBefore).moves().length, inBook: false, rating });
    }
    const c = classifyMove({ move, before, after, legalMoves: new Chess(move.fenBefore).moves().length, inBook: false, previous, rating });
    const mover = move.color;
    const secondEp = before.lines[1] ? expectedScore(before.lines[1].eval, mover) : null;
    out.push(`\n── depth ${d} (${((Date.now() - t0) / 1000).toFixed(0)} s): ${c.cls.toUpperCase()}`);
    before.lines.forEach((l, i) => out.push(`  line ${i + 1}: ${fmt(l.eval)} (E ${expectedScore(l.eval, mover).toFixed(3)})  ${san(move.fenBefore, l.pv)}`));
    out.push(`  played ${move.san}: after ${fmt(after.eval)} (E ${c.after.toFixed(3)}), loss ${c.loss.toFixed(3)}, top move ${c.bestSan}`);
    const onCurve = (e: PositionAnalysis["eval"]) => expectedScoreAt(e, mover, slope).toFixed(3);
    out.push(`  rating ${rating ?? "unknown"} → slope ${slope.toFixed(5)} (Lichess 0.00368)`);
    out.push(`  gates (players' curve): top=${c.bestUci === move.uci}  second ${before.lines[1] ? onCurve(before.lines[1].eval) : "n/a"} (<0.93 for Great)  after ${onCurve(after.eval)} (>=0.45)  notInCheck=${!new Chess(move.fenBefore).inCheck()}`);
    out.push(`  gap to second: ${secondEp === null ? "n/a" : (c.before - secondEp).toFixed(3)} (Great needs 0.10)`);
    const alt = quietAlternative(move.fenBefore, move.uci, before, declined);
    out.push(`  best quiet move: ${alt ? `${san(move.fenBefore, alt.pv.slice(0, 1))} ${fmt(alt.eval)}${before.quiet === alt ? " (searched)" : ""}, margin ${(c.before - expectedScore(alt.eval, mover)).toFixed(3)} (Brilliant needs ${SACRIFICE_MARGIN}), on the players' curve ${onCurve(alt.eval)} (<0.93: not decided without it)` : "none"}`);
    out.push(`  sacrifice: ${c.sacrifice?.pieces.map((p) => `${p.type}${p.square}`).join(", ") || "none"}`);
    const unsafeBefore = unsafePieces(move.fenBefore.replace(/ [wb] /, ` ${mover === "w" ? "b" : "w"} `), mover);
    const unsafeAfter = unsafePieces(move.fenAfter, mover);
    out.push(`  unsafe before: ${unsafeBefore.map((p) => p.type + p.square).join(", ") || "none"} · after: ${unsafeAfter.map((p) => p.type + p.square).join(", ") || "none"} · declined: ${declined.map((p) => p.type + p.square).join(", ") || "none"}`);
  }
  writeFileSync(env.EVAL_OUT ?? "scripts/eval/out/brilliant-diagnose.txt", out.join("\n"));
  console.log(out.join("\n"));
}, 3_600_000);
