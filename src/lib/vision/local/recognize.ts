/**
 * On-device board reading: find the board, classify all 64 squares, then use what
 * a screenshot guarantees (identical pieces look identical) and what chess rules
 * guarantee (one king each, no pawns on the back ranks) to clean up the result.
 * Finally guess which side is at the bottom from where the pawns and kings stand.
 */
import type { Recognition } from "../grid";
import { detectBoard, type BoardGrid } from "./detect";
import { classify, CLASSES, INPUT, type SquareClass, type SquareNet, type SquareOutput } from "./net";
import { cropToTensor, type Raster } from "./raster";

export interface LocalCell {
  piece: SquareClass;
  /** Probability of the chosen piece after cleanup, 0–1. */
  p: number;
  confident: boolean;
}

export interface LocalRecognition {
  grid: BoardGrid;
  /** True when the grid came from detection (false: the whole image was taken as the board). */
  detected: boolean;
  /** As seen in the image: rows top→bottom, columns left→right. */
  rows: LocalCell[][];
  whiteAtBottom: boolean;
  /** False when the piece layout doesn't clearly say which side is at the bottom. */
  orientationSure: boolean;
  /** Mean probability of the chosen pieces, 0–1. */
  confidence: number;
}

const CONFIDENT = 0.8;
const IDX = Object.fromEntries(CLASSES.map((c, i) => [c, i])) as Record<SquareClass, number>;

function cosine(a: Float32Array, b: Float32Array) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / (Math.sqrt(aa * bb) || 1);
}

/**
 * A plainly empty square: the middle is flat and the same colour as the corners.
 * Skipping the network for these roughly halves the reading time.
 */
function plainlyEmpty(t: Float32Array): boolean {
  const n = INPUT;
  const plane = n * n;
  const corner = [0, 0, 0];
  const cs = 4;
  for (const [y0, x0] of [
    [1, 1],
    [1, n - 1 - cs],
    [n - 1 - cs, 1],
    [n - 1 - cs, n - 1 - cs],
  ]) {
    for (let y = y0; y < y0 + cs; y++) for (let x = x0; x < x0 + cs; x++) for (let ch = 0; ch < 3; ch++) corner[ch] += t[ch * plane + y * n + x];
  }
  for (let ch = 0; ch < 3; ch++) corner[ch] /= 4 * cs * cs;
  let maxDiff = 0;
  for (let y = 6; y < n - 6; y++) {
    for (let x = 6; x < n - 6; x++) {
      let d = 0;
      for (let ch = 0; ch < 3; ch++) d += Math.abs(t[ch * plane + y * n + x] - corner[ch]);
      if (d > maxDiff) maxDiff = d;
    }
  }
  return maxDiff < 0.09;
}

const EMPTY_OUT = (width: number): SquareOutput => {
  const probs = new Float32Array(CLASSES.length).fill(0.001);
  probs[0] = 1 - 0.001 * (CLASSES.length - 1);
  return { probs, embedding: new Float32Array(width) };
};

/** One model, or several whose probabilities are averaged (embeddings concatenated). */
export type Nets = SquareNet | SquareNet[];

function run(nets: Nets, input: Float32Array): SquareOutput {
  const list = Array.isArray(nets) ? nets : [nets];
  if (list.length === 1) return classify(list[0], input);
  const outs = list.map((n) => classify(n, input));
  const probs = new Float32Array(outs[0].probs.length);
  for (const o of outs) for (let k = 0; k < probs.length; k++) probs[k] += o.probs[k] / outs.length;
  const embedding = new Float32Array(outs.reduce((s, o) => s + o.embedding.length, 0));
  let off = 0;
  for (const o of outs) {
    embedding.set(o.embedding, off);
    off += o.embedding.length;
  }
  return { probs, embedding };
}

function readCells(img: Raster, grid: BoardGrid, nets: Nets, from: number, to: number, outs: SquareOutput[]) {
  const input = new Float32Array(3 * INPUT * INPUT);
  const width = (Array.isArray(nets) ? nets.length : 1) * 128;
  for (let i = from; i < to; i++) {
    const r = Math.floor(i / 8);
    const c = i % 8;
    cropToTensor(img, grid.x + c * grid.cellW, grid.y + r * grid.cellH, grid.cellW, grid.cellH, INPUT, input, 0);
    outs[i] = plainlyEmpty(input) ? EMPTY_OUT(width) : run(nets, input);
  }
}

function gridFor(img: Raster, override: BoardGrid | null | undefined) {
  const found = override === undefined ? detectBoard(img) : override;
  return { found, grid: found ?? { x: 0, y: 0, cellW: img.width / 8, cellH: img.height / 8, confidence: 0 } };
}

/**
 * Reads the board. `grid`: pass a known grid, or null to treat the whole image as
 * the board (e.g. after a manual crop); omit it to detect the board.
 */
export function recognizeLocal(img: Raster, net: Nets, opts: { grid?: BoardGrid | null } = {}): LocalRecognition {
  const { found, grid } = gridFor(img, opts.grid);
  const outs: SquareOutput[] = [];
  readCells(img, grid, net, 0, 64, outs);
  return finish(outs, grid, !!found);
}

/** Same as recognizeLocal, but yields to the browser between rows so the page stays responsive. */
export async function recognizeLocalAsync(img: Raster, net: Nets, opts: { grid?: BoardGrid | null; onProgress?: (done: number) => void } = {}): Promise<LocalRecognition> {
  const { found, grid } = gridFor(img, opts.grid);
  const outs: SquareOutput[] = [];
  for (let r = 0; r < 8; r++) {
    readCells(img, grid, net, r * 8, r * 8 + 8, outs);
    opts.onProgress?.((r + 1) * 8);
    await new Promise((res) => setTimeout(res, 0));
  }
  return finish(outs, grid, !!found);
}

function finish(outs: SquareOutput[], grid: BoardGrid, detected: boolean): LocalRecognition {
  // 1. Squares that look the same (in the classifier's own embedding) vote together.
  const logp = outs.map((o) => Array.from(o.probs, (p) => Math.log(Math.max(p, 1e-6))));
  const scores = outs.map((o, i) => {
    const acc = logp[i].slice();
    let n = 1;
    for (let j = 0; j < outs.length; j++) {
      if (j === i || cosine(o.embedding, outs[j].embedding) < 0.97) continue;
      for (let k = 0; k < acc.length; k++) acc[k] += logp[j][k];
      n++;
    }
    const m = Math.max(...acc.map((v) => v / n));
    const e = acc.map((v) => Math.exp(v / n - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  });

  const pick = scores.map((p) => {
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
    return best;
  });
  const unsure = new Set<number>();
  const nextBest = (i: number, banned: number[]) => {
    let best = -1;
    for (let k = 0; k < scores[i].length; k++) if (!banned.includes(k) && (best < 0 || scores[i][k] > scores[i][best])) best = k;
    return best;
  };

  // 2. Rules: no pawns on the top or bottom row (ranks 1 and 8 either way round).
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    if ((row === 0 || row === 7) && (pick[i] === IDX.P || pick[i] === IDX.p)) {
      pick[i] = nextBest(i, [IDX.P, IDX.p]);
      unsure.add(i);
    }
  }
  // One king per side: keep the likeliest, re-read the rest.
  for (const K of [IDX.K, IDX.k]) {
    const kings = pick.map((k, i) => (k === K ? i : -1)).filter((i) => i >= 0);
    if (kings.length > 1) {
      kings.sort((a, b) => scores[b][K] - scores[a][K]);
      for (const i of kings.slice(1)) {
        pick[i] = nextBest(i, [K]);
        unsure.add(i);
      }
    } else if (kings.length === 0) {
      let bi = -1;
      for (let i = 0; i < 64; i++) if (pick[i] !== IDX[""] && (bi < 0 || scores[i][K] > scores[bi][K])) bi = i;
      if (bi >= 0 && scores[bi][K] > 0.02) {
        pick[bi] = K;
        unsure.add(bi);
      }
    }
  }

  const rows: LocalCell[][] = [];
  let conf = 0;
  for (let r = 0; r < 8; r++) {
    const row: LocalCell[] = [];
    for (let c = 0; c < 8; c++) {
      const i = r * 8 + c;
      const p = scores[i][pick[i]];
      conf += p;
      row.push({ piece: CLASSES[pick[i]], p, confident: p >= CONFIDENT && !unsure.has(i) });
    }
    rows.push(row);
  }

  // 3. Orientation: pawns and kings usually sit nearer their own side.
  let evidence = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = rows[r][c].piece;
      const towardBottom = (r - 3.5) / 3.5;
      if (piece === "P") evidence += towardBottom;
      else if (piece === "p") evidence -= towardBottom;
      else if (piece === "K") evidence += 1.5 * towardBottom;
      else if (piece === "k") evidence -= 1.5 * towardBottom;
    }
  }
  return {
    grid,
    detected,
    rows,
    whiteAtBottom: evidence >= 0,
    orientationSure: Math.abs(evidence) >= 2,
    confidence: conf / 64,
  };
}

/** The shape the rest of the app already understands (and the cloud reader returns). */
export function toRecognition(r: LocalRecognition): Recognition {
  return {
    board_found: true,
    notes: "",
    rows: r.rows.map((row) => row.map((c) => ({ piece: c.piece, confident: c.confident }))),
  };
}
