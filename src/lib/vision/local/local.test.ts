/**
 * The on-device board reader, end to end: detection, the two shipped models,
 * cleanup and the orientation guess, on fixtures drawn with the site's own pieces
 * (scripts/vision/make-fixtures.py). Accuracy on unseen piece sets is measured
 * separately (scripts/vision/README.md).
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ALL_SQUARES } from "../../chess/board";
import { placementFromFen } from "../../chess/fen";
import { gridToPlacement } from "../grid";
import { detectBoard } from "./detect";
import { parseNet } from "./net";
import { recognizeLocal, toRecognition } from "./recognize";

const dir = new URL("./fixtures/", import.meta.url);
const load = (f: string) => {
  const b = readFileSync(new URL(`../../../../public/models/${f}`, import.meta.url));
  return parseNet(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const nets = [load("squares-a.bin"), load("squares-b.bin")];
const labels: { file: string; w: number; h: number; fen: string; flipped: boolean }[] = JSON.parse(readFileSync(new URL("labels.json", dir), "utf8"));
const key = (p: ReturnType<typeof placementFromFen>, s: (typeof ALL_SQUARES)[number]) => (p[s] ? p[s]!.color + p[s]!.type : "");

describe("on-device board reading", () => {
  for (const x of labels) {
    it(`reads ${x.file} exactly, including which side is at the bottom`, () => {
      const img = { width: x.w, height: x.h, data: new Uint8Array(gunzipSync(readFileSync(new URL(x.file, dir)))) };
      const rec = recognizeLocal(img, nets);
      expect(rec.detected).toBe(true);
      expect(rec.whiteAtBottom).toBe(!x.flipped);
      const { placement } = gridToPlacement(toRecognition(rec).rows, rec.whiteAtBottom);
      const truth = placementFromFen(x.fen);
      expect(ALL_SQUARES.filter((s) => key(truth, s) !== key(placement, s))).toEqual([]);
      expect(rec.confidence).toBeGreaterThan(0.9);
    }, 30_000);
  }

  it("finds no board in a flat image", () => {
    const w = 320;
    const data = new Uint8Array(w * w * 4).fill(200);
    expect(detectBoard({ width: w, height: w, data })).toBeNull();
  });

  it("rejects a file that isn't a weights file", () => {
    expect(() => parseNet(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow();
  });
});
