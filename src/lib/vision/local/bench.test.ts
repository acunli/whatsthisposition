/**
 * Accuracy benchmark on a held-out test set (built by scripts/vision/make-testset.py).
 * Skipped unless VISION_BENCH_DIR points at one:
 *   VISION_BENCH_DIR=… [MODEL=a.bin+b.bin] npx vitest run src/lib/vision/local/bench.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { placementFromFen } from "../../chess/fen";
import { ALL_SQUARES } from "../../chess/board";
import { gridToPlacement } from "../grid";
import { parseNet } from "./net";
import { recognizeLocal, toRecognition } from "./recognize";
const DIR = process.env.VISION_BENCH_DIR ? process.env.VISION_BENCH_DIR.replace(/\/?$/, "/") : "";
const MODELS = new URL("../../../../public/models/", import.meta.url).pathname;
it.skipIf(!DIR)("benchmark the board reader", () => {
  const model = process.env.MODEL ?? "squares-a.bin+squares-b.bin";
  const nets = model.split("+").map((m) => {
    const buf = readFileSync(m.startsWith("/") ? m : MODELS + m);
    return parseNet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  });
  const net = nets.length === 1 ? nets[0] : nets;
  const items = JSON.parse(readFileSync(DIR + "labels.json", "utf8"));
  const lines: string[] = [];
  let squaresWrong = 0, boardsExact = 0, orientRight = 0, total = 0;
  const t0 = Date.now();
  for (const x of items) {
    const data = new Uint8Array(readFileSync(DIR + x.file + ".rgba"));
    const rec = recognizeLocal({ width: x.w, height: x.h, data }, net);
    const truth = placementFromFen(x.fen);
    // classifier accuracy with the TRUE orientation, plus whether our orientation guess was right
    const { placement } = gridToPlacement(toRecognition(rec).rows, !x.flipped);
    const wrong = ALL_SQUARES.filter((s) => (truth[s] ? truth[s]!.color + truth[s]!.type : "") !== (placement[s] ? placement[s]!.color + placement[s]!.type : ""));
    squaresWrong += wrong.length;
    if (!wrong.length) boardsExact++;
    if (rec.whiteAtBottom === !x.flipped) orientRight++;
    total++;
    lines.push(`${x.file}\t${x.source}\twrong=${wrong.length}\torient=${rec.whiteAtBottom === !x.flipped ? "ok" : "WRONG"}${rec.orientationSure ? "" : "(unsure)"}\tconf=${rec.confidence.toFixed(3)}\t${wrong.map((s) => `${s}:${truth[s] ? truth[s]!.color + truth[s]!.type : "-"}→${placement[s] ? placement[s]!.color + placement[s]!.type : "-"}`).join(" ")}`);
  }
  lines.unshift(`model ${model}: boards exact ${boardsExact}/${total}, squares wrong ${squaresWrong}/${total * 64} (${((1 - squaresWrong / (total * 64)) * 100).toFixed(2)}% right), orientation right ${orientRight}/${total}, ${((Date.now() - t0) / total).toFixed(0)} ms/image`);
  writeFileSync(DIR + "results.txt", lines.join("\n"));
  console.log(lines[0]);
}, 900_000);
